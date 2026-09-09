using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Auth;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services;
using Codex.Api.Services.OAuth;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Codex.Api.Tests;

public class OAuthServiceTests
{
    private const string RedirectBaseUrl = "https://playcodex.com.br";

    /// <summary>Provedor de mentira: substitui a ida a rede pelo perfil que ela devolveria.</summary>
    private class FakeProviderClient(OAuthProvider provider, OAuthProfile profile, bool configured = true) : IOAuthProviderClient
    {
        public OAuthProvider Provider => provider;
        public bool IsConfigured => configured;

        /// <summary>Mutavel para simular o mesmo sub voltando com outro email num login posterior.</summary>
        public OAuthProfile Profile { get; set; } = profile;

        public string? LastRedirectUri { get; private set; }
        public string? LastCodeVerifier { get; private set; }

        public string BuildAuthorizeUrl(string redirectUri, string state, string codeChallenge)
        {
            LastRedirectUri = redirectUri;
            return $"https://provedor.exemplo/auth?redirect_uri={redirectUri}&state={state}&code_challenge={codeChallenge}";
        }

        public Task<OAuthProfile> FetchProfileAsync(string code, string redirectUri, string codeVerifier, CancellationToken ct)
        {
            LastRedirectUri = redirectUri;
            LastCodeVerifier = codeVerifier;
            return Task.FromResult(Profile);
        }
    }

    private static OAuthService CreateService(
        out AppDbContext db,
        OAuthProfile? profile = null,
        OAuthProvider provider = OAuthProvider.Google,
        bool configured = true,
        string? redirectBaseUrl = RedirectBaseUrl)
        => CreateService(out db, out _, profile, provider, configured, redirectBaseUrl);

    private static OAuthService CreateService(
        out AppDbContext db,
        out FakeProviderClient client,
        OAuthProfile? profile = null,
        OAuthProvider provider = OAuthProvider.Google,
        bool configured = true,
        string? redirectBaseUrl = RedirectBaseUrl)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        db = new AppDbContext(options);

        var protection = new EphemeralDataProtectionProvider();
        var settings = new Dictionary<string, string?>();
        if (redirectBaseUrl is not null)
        {
            settings[$"{OAuthOptions.SectionName}:RedirectBaseUrl"] = redirectBaseUrl;
        }
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();

        client = new FakeProviderClient(provider, profile ?? Verified("ana@escola.br"), configured);
        var authService = new AuthService(db, new PasswordHasher<User>(), new SessionTokenService(protection), configuration);

        return new OAuthService(db, authService, new OAuthStateService(protection), [client], configuration);
    }

    private static OAuthProfile Verified(string email, string? name = "Ana Silva", string subject = "sub-1")
        => new(subject, email, EmailVerified: true, Name: name);

    private static string StateFor(OAuthService service, string provider = "google", string? redirectTo = null)
        => service.BuildAuthorizeUrl(provider, new OAuthAuthorizeRequest(redirectTo)).State;

    [Fact]
    public void BuildAuthorizeUrl_uses_the_next_origin_as_redirect_uri()
    {
        var service = CreateService(out _, out var client);

        service.BuildAuthorizeUrl("google", new OAuthAuthorizeRequest(null));

        Assert.Equal("https://playcodex.com.br/auth/callback/google", client.LastRedirectUri);
    }

    [Fact]
    public void BuildAuthorizeUrl_accepts_the_provider_slug_case_insensitively()
    {
        var service = CreateService(out _);

        var response = service.BuildAuthorizeUrl("GOOGLE", new OAuthAuthorizeRequest(null));

        Assert.False(string.IsNullOrEmpty(response.State));
    }

    [Fact]
    public void BuildAuthorizeUrl_rejects_an_unknown_provider()
    {
        var service = CreateService(out _);

        var exception = Assert.Throws<ApiException>(() => service.BuildAuthorizeUrl("facebook", new OAuthAuthorizeRequest(null)));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
    }

    [Fact]
    public void BuildAuthorizeUrl_reports_a_provider_without_credentials()
    {
        var service = CreateService(out _, configured: false);

        var exception = Assert.Throws<ApiException>(() => service.BuildAuthorizeUrl("google", new OAuthAuthorizeRequest(null)));

        Assert.Equal(ErrorCodes.OAuthProviderNotConfigured, exception.Code);
        Assert.Equal(StatusCodes.Status501NotImplemented, exception.StatusCode);
    }

    [Fact]
    public void BuildAuthorizeUrl_reports_a_missing_redirect_base_url()
    {
        var service = CreateService(out _, redirectBaseUrl: null);

        var exception = Assert.Throws<ApiException>(() => service.BuildAuthorizeUrl("google", new OAuthAuthorizeRequest(null)));

        Assert.Equal(ErrorCodes.OAuthProviderNotConfigured, exception.Code);
    }

    [Theory]
    [InlineData(null, "/perfil")]
    [InlineData("", "/perfil")]
    [InlineData("/sala", "/sala")]
    [InlineData("/conjunto/novo", "/conjunto/novo")]
    // Redirecionamento aberto: as tres formas de escapar do proprio dominio.
    [InlineData("//evil.example", "/perfil")]
    [InlineData("https://evil.example", "/perfil")]
    [InlineData("/\\evil.example", "/perfil")]
    public async Task CompleteAsync_only_ever_returns_an_internal_path(string? requested, string expected)
    {
        var service = CreateService(out _);
        var state = StateFor(service, redirectTo: requested);

        var response = await service.CompleteAsync("google", new OAuthCallbackRequest("code", state), CancellationToken.None);

        Assert.Equal(expected, response.RedirectTo);
    }

    [Fact]
    public async Task CompleteAsync_creates_an_account_without_a_password()
    {
        var service = CreateService(out var db);
        var state = StateFor(service);

        var response = await service.CompleteAsync("google", new OAuthCallbackRequest("code", state), CancellationToken.None);

        var user = await db.Users.SingleAsync();
        Assert.Equal("ana@escola.br", user.Email);
        Assert.Equal("Ana Silva", user.Name);
        Assert.Null(user.PasswordHash);
        Assert.Equal(user.Id, response.User.Id);
        Assert.False(string.IsNullOrEmpty(response.Token));

        var identity = await db.UserIdentities.SingleAsync();
        Assert.Equal(user.Id, identity.UserId);
        Assert.Equal(OAuthProvider.Google, identity.Provider);
        Assert.Equal("sub-1", identity.ProviderUserId);
    }

    [Fact]
    public async Task CompleteAsync_names_the_account_after_the_email_when_the_provider_sends_none()
    {
        var service = CreateService(out var db, Verified("ana@escola.br", name: null));

        await service.CompleteAsync("google", new OAuthCallbackRequest("code", StateFor(service)), CancellationToken.None);

        Assert.Equal("ana", (await db.Users.SingleAsync()).Name);
    }

    [Fact]
    public async Task CompleteAsync_links_a_verified_email_to_the_existing_password_account()
    {
        var service = CreateService(out var db);
        var existing = new User { Name = "Ana Silva", Email = "ana@escola.br", PasswordHash = "hash" };
        db.Users.Add(existing);
        await db.SaveChangesAsync();

        var response = await service.CompleteAsync("google", new OAuthCallbackRequest("code", StateFor(service)), CancellationToken.None);

        Assert.Equal(existing.Id, response.User.Id);
        Assert.Equal(1, await db.Users.CountAsync());
        Assert.Equal(existing.Id, (await db.UserIdentities.SingleAsync()).UserId);
        // A senha continua valendo: vincular um provedor nao tira o outro caminho de entrada.
        Assert.Equal("hash", (await db.Users.SingleAsync()).PasswordHash);
    }

    [Fact]
    public async Task CompleteAsync_reuses_the_link_on_the_second_login()
    {
        var service = CreateService(out var db);

        var first = await service.CompleteAsync("google", new OAuthCallbackRequest("code", StateFor(service)), CancellationToken.None);
        var second = await service.CompleteAsync("google", new OAuthCallbackRequest("code", StateFor(service)), CancellationToken.None);

        Assert.Equal(first.User.Id, second.User.Id);
        Assert.Equal(1, await db.Users.CountAsync());
        Assert.Equal(1, await db.UserIdentities.CountAsync());
    }

    [Fact]
    public async Task CompleteAsync_follows_the_subject_and_not_the_email_when_the_email_changes()
    {
        var service = CreateService(out var db, out var client);
        var first = await service.CompleteAsync("google", new OAuthCallbackRequest("code", StateFor(service)), CancellationToken.None);

        // Mesma pessoa no provedor (mesmo sub), endereco novo: o vinculo manda, nao o email.
        client.Profile = Verified("ana.silva@escola.br");
        var second = await service.CompleteAsync("google", new OAuthCallbackRequest("code", StateFor(service)), CancellationToken.None);

        Assert.Equal(first.User.Id, second.User.Id);
        Assert.Equal(1, await db.Users.CountAsync());
        Assert.Equal("ana@escola.br", (await db.Users.SingleAsync()).Email);
    }

    [Fact]
    public async Task CompleteAsync_refuses_an_unverified_email()
    {
        var service = CreateService(out var db, new OAuthProfile("sub-1", "ana@escola.br", EmailVerified: false, Name: "Ana"));

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => service.CompleteAsync("google", new OAuthCallbackRequest("code", StateFor(service)), CancellationToken.None));

        Assert.Equal(ErrorCodes.OAuthEmailNotVerified, exception.Code);
        Assert.Equal(StatusCodes.Status409Conflict, exception.StatusCode);
        Assert.Equal(0, await db.Users.CountAsync());
    }

    [Fact]
    public async Task CompleteAsync_refuses_a_provider_that_sends_no_email()
    {
        var service = CreateService(out _, new OAuthProfile("sub-1", null, EmailVerified: true, Name: "Ana"));

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => service.CompleteAsync("google", new OAuthCallbackRequest("code", StateFor(service)), CancellationToken.None));

        Assert.Equal(ErrorCodes.OAuthEmailNotVerified, exception.Code);
    }

    [Fact]
    public async Task CompleteAsync_refuses_a_tampered_state()
    {
        var service = CreateService(out _);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => service.CompleteAsync("google", new OAuthCallbackRequest("code", "nao-e-um-state"), CancellationToken.None));

        Assert.Equal(ErrorCodes.OAuthStateInvalid, exception.Code);
    }

    [Fact]
    public async Task CompleteAsync_refuses_a_state_issued_for_another_provider()
    {
        // O state e do Google; o callback chega como se fosse do GitHub.
        var google = CreateService(out _);
        var state = StateFor(google);

        var github = CreateService(out _, provider: OAuthProvider.GitHub);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => github.CompleteAsync("github", new OAuthCallbackRequest("code", state), CancellationToken.None));

        Assert.Equal(ErrorCodes.OAuthStateInvalid, exception.Code);
    }

    [Fact]
    public async Task CompleteAsync_refuses_an_empty_code()
    {
        var service = CreateService(out _);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => service.CompleteAsync("google", new OAuthCallbackRequest("", StateFor(service)), CancellationToken.None));

        Assert.Equal(ErrorCodes.ValidationError, exception.Code);
    }

    [Fact]
    public async Task CompleteAsync_hands_the_provider_the_verifier_that_matches_the_challenge()
    {
        var service = CreateService(out _, out var client);
        var authorize = service.BuildAuthorizeUrl("google", new OAuthAuthorizeRequest(null));

        await service.CompleteAsync("google", new OAuthCallbackRequest("code", authorize.State), CancellationToken.None);

        Assert.NotNull(client.LastCodeVerifier);
        Assert.Contains($"code_challenge={Pkce.Challenge(client.LastCodeVerifier!)}", authorize.AuthorizeUrl);
    }
}
