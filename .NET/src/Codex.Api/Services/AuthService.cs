using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts;
using Codex.Api.Contracts.Auth;
using Codex.Api.Data;
using Codex.Api.Domain.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Codex.Api.Services;

/// <summary>api-rest.md secao 2. Login/signup emitem o mesmo formato de resposta (AuthResponse).</summary>
public class AuthService(
    AppDbContext db,
    IPasswordHasher<User> passwordHasher,
    ISessionTokenService tokenService,
    IConfiguration configuration)
{
    public async Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken ct)
    {
        var user = await db.Users.SingleOrDefaultAsync(u => u.Email == request.Email, ct);
        if (user is null || user.PasswordHash is null || !VerifyPassword(user, user.PasswordHash, request.Password))
        {
            throw new ApiException(StatusCodes.Status401Unauthorized, ErrorCodes.InvalidCredentials, "Email ou senha incorretos.");
        }

        return IssueUserSession(user, request.RememberMe);
    }

    public async Task<AuthResponse> SignupAsync(SignupRequest request, CancellationToken ct)
    {
        var emailTaken = await db.Users.AnyAsync(u => u.Email == request.Email, ct);
        if (emailTaken)
        {
            throw new ApiException(StatusCodes.Status409Conflict, ErrorCodes.EmailAlreadyUsed, "Ja existe uma conta com este email.");
        }

        var user = new User { Name = request.Name, Email = request.Email, AvatarIndex = 0 };
        user.PasswordHash = passwordHasher.HashPassword(user, request.Password);

        db.Users.Add(user);
        await db.SaveChangesAsync(ct);

        // rememberMe nao existe no signup (secao 2); comeca com a duracao padrao.
        return IssueUserSession(user, rememberMe: false);
    }

    private bool VerifyPassword(User user, string hash, string providedPassword)
        => passwordHasher.VerifyHashedPassword(user, hash, providedPassword) != PasswordVerificationResult.Failed;

    /// <summary>Publico porque o login social (OAuthService) emite exatamente a mesma sessao ao fim do fluxo.</summary>
    public AuthResponse IssueUserSession(User user, bool rememberMe)
    {
        var lifetime = rememberMe
            ? TimeSpan.FromDays(configuration.GetValue("CodexApi:UserSessionRememberMeLifetimeDays", 30))
            : TimeSpan.FromHours(configuration.GetValue("CodexApi:UserSessionDefaultLifetimeHours", 12));

        var expiresAt = DateTimeOffset.UtcNow.Add(lifetime);
        var token = tokenService.Issue(new SessionTokenPayload(user.Id, null, null, expiresAt));

        return new AuthResponse(token, (int)lifetime.TotalSeconds, ToDto(user));
    }

    public static UserDto ToDto(User user, bool includeEmail = true)
        => new(user.Id, user.Name, includeEmail ? user.Email : string.Empty, user.AvatarIndex, user.Plan, user.Audience);
}
