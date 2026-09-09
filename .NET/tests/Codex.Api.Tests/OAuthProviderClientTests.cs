using System.Text;
using System.Text.Json;
using Codex.Api.Common.Errors;
using Codex.Api.Services.OAuth;
using Microsoft.AspNetCore.WebUtilities;

namespace Codex.Api.Tests;

/// <summary>
/// Cobre a parte do OAuth que muda de provedor para provedor: transformar a resposta de cada um
/// no mesmo <see cref="OAuthProfile"/>. Sem rede — as entradas sao as respostas reais que Google,
/// Microsoft e GitHub devolvem.
/// </summary>
public class OAuthProviderClientTests
{
    private static JsonElement Claims(string json) => JsonDocument.Parse(json).RootElement;

    private static string FakeIdToken(string payloadJson)
        => $"{Segment("{\"alg\":\"RS256\"}")}.{Segment(payloadJson)}.assinatura-nao-verificada";

    private static string Segment(string json)
        => WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(json));

    [Fact]
    public void IdToken_reads_the_payload_segment()
    {
        using var document = IdToken.ReadClaims(FakeIdToken("""{"sub":"1","email":"ana@escola.br"}"""));

        Assert.Equal("ana@escola.br", document.RootElement.String("email"));
    }

    [Fact]
    public void IdToken_rejects_a_malformed_token()
    {
        var exception = Assert.Throws<ApiException>(() => IdToken.ReadClaims("nao-e-um-jwt"));

        Assert.Equal(ErrorCodes.OAuthExchangeFailed, exception.Code);
    }

    [Theory]
    [InlineData("""{"email_verified":true}""", true)]
    [InlineData("""{"email_verified":"true"}""", true)]
    [InlineData("""{"email_verified":false}""", false)]
    [InlineData("""{"email_verified":"false"}""", false)]
    [InlineData("""{}""", false)]
    public void IdToken_accepts_email_verified_as_boolean_or_string(string json, bool expected)
        => Assert.Equal(expected, Claims(json).Bool("email_verified"));

    [Fact]
    public void Google_reads_sub_email_and_verification()
    {
        var client = new GoogleOAuthClient(new OAuthProviderOptions(), null!);

        var profile = client.ReadProfile(Claims("""
            {"sub":"108","email":"ana@escola.br","email_verified":true,"name":"Ana Silva"}
            """));

        Assert.Equal("108", profile.Subject);
        Assert.Equal("ana@escola.br", profile.Email);
        Assert.True(profile.EmailVerified);
        Assert.Equal("Ana Silva", profile.Name);
    }

    [Fact]
    public void Google_keeps_an_unverified_email_unverified()
    {
        var client = new GoogleOAuthClient(new OAuthProviderOptions(), null!);

        var profile = client.ReadProfile(Claims("""{"sub":"108","email":"ana@escola.br","email_verified":false}"""));

        Assert.False(profile.EmailVerified);
    }

    [Fact]
    public void Google_fails_without_a_subject()
    {
        var client = new GoogleOAuthClient(new OAuthProviderOptions(), null!);

        var exception = Assert.Throws<ApiException>(() => client.ReadProfile(Claims("""{"email":"ana@escola.br"}""")));

        Assert.Equal(ErrorCodes.OAuthExchangeFailed, exception.Code);
    }

    [Fact]
    public void Microsoft_falls_back_to_preferred_username_when_email_is_absent()
    {
        var client = new MicrosoftOAuthClient(new OAuthProviderOptions(), null!);

        var profile = client.ReadProfile(Claims("""
            {"sub":"AAA","preferred_username":"ana@outlook.com","name":"Ana Silva"}
            """));

        Assert.Equal("ana@outlook.com", profile.Email);
        Assert.True(profile.EmailVerified);
    }

    [Fact]
    public void Microsoft_reports_no_verified_email_when_it_sends_neither_claim()
    {
        var client = new MicrosoftOAuthClient(new OAuthProviderOptions(), null!);

        var profile = client.ReadProfile(Claims("""{"sub":"AAA","name":"Ana Silva"}"""));

        Assert.Null(profile.Email);
        Assert.False(profile.EmailVerified);
    }

    [Fact]
    public void GitHub_prefers_the_primary_verified_email()
    {
        var (email, verified) = GitHubOAuthClient.PickEmail(Claims("""
            [
              {"email":"antigo@escola.br","primary":false,"verified":true},
              {"email":"ana@escola.br","primary":true,"verified":true}
            ]
            """));

        Assert.Equal("ana@escola.br", email);
        Assert.True(verified);
    }

    [Fact]
    public void GitHub_falls_back_to_any_verified_email_when_the_primary_is_unverified()
    {
        var (email, verified) = GitHubOAuthClient.PickEmail(Claims("""
            [
              {"email":"ana@escola.br","primary":true,"verified":false},
              {"email":"outro@escola.br","primary":false,"verified":true}
            ]
            """));

        Assert.Equal("outro@escola.br", email);
        Assert.True(verified);
    }

    [Fact]
    public void GitHub_never_reports_an_unverified_email_as_verified()
    {
        var (email, verified) = GitHubOAuthClient.PickEmail(Claims("""
            [{"email":"ana@escola.br","primary":true,"verified":false}]
            """));

        Assert.Null(email);
        Assert.False(verified);
    }

    [Fact]
    public void GitHub_handles_an_account_with_no_listed_emails()
    {
        var (email, verified) = GitHubOAuthClient.PickEmail(Claims("[]"));

        Assert.Null(email);
        Assert.False(verified);
    }

    [Fact]
    public void GitHub_authorize_url_asks_for_the_private_email_scope()
    {
        var client = new GitHubOAuthClient(new OAuthProviderOptions { ClientId = "cid", ClientSecret = "secret" }, null!);

        var url = client.BuildAuthorizeUrl("https://playcodex.com.br/auth/callback/github", "st4te", "ignorado");

        Assert.Contains("client_id=cid", url);
        Assert.Contains("scope=read%3Auser%20user%3Aemail", url);
        Assert.Contains("state=st4te", url);
        // OAuth Apps ignoram PKCE; mandar o challenge so poluiria a URL.
        Assert.DoesNotContain("code_challenge", url);
    }

    [Fact]
    public void Oidc_authorize_url_carries_the_pkce_challenge()
    {
        var client = new GoogleOAuthClient(new OAuthProviderOptions { ClientId = "cid", ClientSecret = "secret" }, null!);

        var url = client.BuildAuthorizeUrl("https://playcodex.com.br/auth/callback/google", "st4te", "ch4llenge");

        Assert.Contains("response_type=code", url);
        Assert.Contains("code_challenge=ch4llenge", url);
        Assert.Contains("code_challenge_method=S256", url);
        Assert.Contains("prompt=select_account", url);
    }

    [Fact]
    public void Pkce_challenge_is_the_base64url_sha256_of_the_verifier()
    {
        // Vetor do RFC 7636, apendice B.
        Assert.Equal(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            Pkce.Challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
    }

    [Fact]
    public void Pkce_verifier_is_fresh_on_every_call()
        => Assert.NotEqual(Pkce.CreateVerifier(), Pkce.CreateVerifier());
}
