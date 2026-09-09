using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Auth;
using Codex.Api.Data;
using Codex.Api.Data.Configurations;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services.OAuth;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Codex.Api.Services;

/// <summary>
/// api-rest.md secao 2, login social. Duas rotas: <c>authorize</c> monta a URL de consentimento,
/// <c>callback</c> troca o codigo e emite a mesma sessao do login por senha.
///
/// O callback do provedor aterrissa no Next, nao aqui: o ServiceTokenMiddleware recusa qualquer
/// requisicao sem <c>x-service-token</c>, e um redirect de browser nunca traria esse header. O
/// Next recebe o redirect, chama esta rota pelo servidor e grava o cookie — o mesmo caminho que
/// o login por senha ja percorre.
/// </summary>
public class OAuthService(
    AppDbContext db,
    AuthService authService,
    IOAuthStateService stateService,
    IEnumerable<IOAuthProviderClient> providers,
    IConfiguration configuration)
{
    /// <summary>Janela entre clicar no botao e voltar do provedor. Curta porque o state nao tem uso unico no servidor (ver OAuthStateService).</summary>
    private static readonly TimeSpan StateLifetime = TimeSpan.FromMinutes(10);

    private const string DefaultRedirectTo = "/perfil";

    public OAuthAuthorizeResponse BuildAuthorizeUrl(string providerSlug, OAuthAuthorizeRequest request)
    {
        var client = Resolve(providerSlug);
        var verifier = Pkce.CreateVerifier();
        var redirectTo = NormalizeRedirectTo(request.RedirectTo);

        var state = stateService.Issue(new OAuthStatePayload(
            client.Provider,
            redirectTo,
            verifier,
            DateTimeOffset.UtcNow.Add(StateLifetime)));

        var url = client.BuildAuthorizeUrl(RedirectUri(client.Provider), state, Pkce.Challenge(verifier));

        return new OAuthAuthorizeResponse(url, state);
    }

    public async Task<OAuthCallbackResponse> CompleteAsync(string providerSlug, OAuthCallbackRequest request, CancellationToken ct)
    {
        var client = Resolve(providerSlug);

        if (!stateService.TryValidate(request.State, out var state) || state.Provider != client.Provider)
        {
            throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.OAuthStateInvalid, "O login expirou ou foi interrompido. Tente de novo.");
        }

        if (string.IsNullOrWhiteSpace(request.Code))
        {
            throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, "Codigo de autorizacao ausente.");
        }

        var profile = await client.FetchProfileAsync(request.Code, RedirectUri(client.Provider), state.CodeVerifier, ct);
        var user = await ResolveUserAsync(client.Provider, profile, ct);

        // rememberMe: false, a mesma escolha do signup — o contrato so oferece o "lembrar de mim"
        // na tela de login por senha, e o fluxo social nao tem onde perguntar.
        var session = authService.IssueUserSession(user, rememberMe: false);

        return new OAuthCallbackResponse(session.Token, session.ExpiresIn, session.User, state.RedirectTo);
    }

    /// <summary>
    /// Tres caminhos, nesta ordem: identidade ja vinculada, conta existente com o mesmo email
    /// (so se o provedor afirma que o email e verificado), conta nova.
    /// </summary>
    private async Task<User> ResolveUserAsync(OAuthProvider provider, OAuthProfile profile, CancellationToken ct)
    {
        var linked = await FindLinkedUserAsync(provider, profile.Subject, ct);
        if (linked is not null)
        {
            return linked;
        }

        if (profile.Email is not { Length: > 0 } email || !profile.EmailVerified)
        {
            throw new ApiException(
                StatusCodes.Status409Conflict,
                ErrorCodes.OAuthEmailNotVerified,
                "Este provedor nao confirmou um email verificado. Entre com email e senha.");
        }

        // A comparacao de email e exata e sensivel a maiusculas em toda a base (decisao
        // registrada em UserProfileService); o caminho social nao cria uma segunda regra.
        var user = await db.Users.SingleOrDefaultAsync(u => u.Email == email, ct);

        if (user is null)
        {
            // PasswordHash fica nulo: conta que so existe pelo provedor. LoginAsync ja recusa
            // login por senha nesse caso.
            user = new User { Name = ChooseName(profile, email), Email = email, AvatarIndex = 0 };
            db.Users.Add(user);
        }

        db.UserIdentities.Add(new UserIdentity
        {
            UserId = user.Id,
            Provider = provider,
            ProviderUserId = profile.Subject,
            Email = email,
        });

        try
        {
            // Um unico SaveChanges: o EF envia conta e identidade na mesma transacao, entao nao
            // ha como sobrar uma conta sem vinculo.
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException exception) when (IsDuplicateIdentity(exception))
        {
            // Corrida entre duas abas do mesmo login. Quem chegou primeiro ja criou o vinculo.
            db.ChangeTracker.Clear();
            return await FindLinkedUserAsync(provider, profile.Subject, ct)
                ?? throw OAuthErrors.ExchangeFailed("vinculo concorrente nao pode ser resolvido.");
        }
        catch (DbUpdateException exception) when (IsDuplicateEmail(exception))
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.EmailAlreadyUsed, "Ja existe uma conta com este email.");
        }

        return user;
    }

    private Task<User?> FindLinkedUserAsync(OAuthProvider provider, string subject, CancellationToken ct)
        => db.UserIdentities
            .Where(i => i.Provider == provider && i.ProviderUserId == subject)
            .Select(i => i.User!)
            .SingleOrDefaultAsync(ct);

    private IOAuthProviderClient Resolve(string providerSlug)
    {
        var client = providers.SingleOrDefault(p => string.Equals(p.Provider.ToString(), providerSlug, StringComparison.OrdinalIgnoreCase))
            ?? throw new ApiException(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, "Provedor desconhecido.");

        if (!client.IsConfigured)
        {
            throw new ApiException(
                StatusCodes.Status501NotImplemented,
                ErrorCodes.OAuthProviderNotConfigured,
                "Este provedor nao esta configurado nesta instalacao.");
        }

        return client;
    }

    private string RedirectUri(OAuthProvider provider)
    {
        var baseUrl = configuration[$"{OAuthOptions.SectionName}:RedirectBaseUrl"]?.TrimEnd('/');
        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            throw new ApiException(
                StatusCodes.Status501NotImplemented,
                ErrorCodes.OAuthProviderNotConfigured,
                "CodexApi:OAuth:RedirectBaseUrl nao configurado.");
        }

        // Precisa bater caractere a caractere com o que esta registrado no provedor.
        return $"{baseUrl}/auth/callback/{provider.ToString().ToLowerInvariant()}";
    }

    /// <summary>
    /// So caminho interno do proprio site. Recusar "//host" junto com "http://host" e o que
    /// impede o parametro de virar um redirecionamento aberto para fora do dominio.
    /// </summary>
    private static string NormalizeRedirectTo(string? redirectTo)
        => redirectTo is { Length: > 1 } value && value[0] == '/' && value[1] != '/' && !value.Contains('\\')
            ? value
            : DefaultRedirectTo;

    private static string ChooseName(OAuthProfile profile, string email)
        => profile.Name is { Length: > 0 } name ? name[..Math.Min(name.Length, 120)] : email.Split('@')[0];

    private static bool IsDuplicateIdentity(DbUpdateException exception)
        => exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: UserIdentityConfiguration.UniqueProviderSubjectIndex,
        };

    private static bool IsDuplicateEmail(DbUpdateException exception)
        => exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: UserConfiguration.UniqueEmailIndex,
        };
}
