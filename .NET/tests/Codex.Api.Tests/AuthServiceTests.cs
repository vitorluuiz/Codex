using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts.Auth;
using Codex.Api.Data;
using Codex.Api.Domain.Entities;
using Codex.Api.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Codex.Api.Tests;

public class AuthServiceTests
{
    private static AuthService CreateService(out AppDbContext db)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        db = new AppDbContext(options);

        var tokenService = new SessionTokenService(new EphemeralDataProtectionProvider());
        var passwordHasher = new PasswordHasher<User>();
        var configuration = new ConfigurationBuilder().Build();

        return new AuthService(db, passwordHasher, tokenService, configuration);
    }

    [Fact]
    public async Task SignupAsync_creates_user_and_returns_token()
    {
        var service = CreateService(out var db);
        var request = new SignupRequest("Ana Silva", "ana@escola.br", "senha-forte-123");

        var response = await service.SignupAsync(request, CancellationToken.None);

        Assert.Equal("Ana Silva", response.User.Name);
        Assert.False(string.IsNullOrEmpty(response.Token));
        Assert.Equal(1, await db.Users.CountAsync());
    }

    [Fact]
    public async Task SignupAsync_rejects_duplicate_email()
    {
        var service = CreateService(out _);
        var request = new SignupRequest("Ana Silva", "ana@escola.br", "senha-forte-123");
        await service.SignupAsync(request, CancellationToken.None);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => service.SignupAsync(request with { Name = "Outra Ana" }, CancellationToken.None));

        Assert.Equal(ErrorCodes.EmailAlreadyUsed, exception.Code);
        Assert.Equal(StatusCodes.Status409Conflict, exception.StatusCode);
    }

    [Fact]
    public async Task LoginAsync_succeeds_with_correct_password()
    {
        var service = CreateService(out _);
        await service.SignupAsync(new SignupRequest("Ana Silva", "ana@escola.br", "senha-forte-123"), CancellationToken.None);

        var response = await service.LoginAsync(new LoginRequest("ana@escola.br", "senha-forte-123", RememberMe: false), CancellationToken.None);

        Assert.Equal("ana@escola.br", response.User.Email);
    }

    [Fact]
    public async Task LoginAsync_rejects_wrong_password()
    {
        var service = CreateService(out _);
        await service.SignupAsync(new SignupRequest("Ana Silva", "ana@escola.br", "senha-forte-123"), CancellationToken.None);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => service.LoginAsync(new LoginRequest("ana@escola.br", "senha-errada", RememberMe: false), CancellationToken.None));

        Assert.Equal(ErrorCodes.InvalidCredentials, exception.Code);
        Assert.Equal(StatusCodes.Status401Unauthorized, exception.StatusCode);
    }

    [Fact]
    public async Task LoginAsync_rejects_unknown_email()
    {
        var service = CreateService(out _);

        var exception = await Assert.ThrowsAsync<ApiException>(
            () => service.LoginAsync(new LoginRequest("ninguem@escola.br", "qualquer", RememberMe: false), CancellationToken.None));

        Assert.Equal(ErrorCodes.InvalidCredentials, exception.Code);
    }

    [Fact]
    public async Task LoginAsync_remember_me_extends_expiresIn()
    {
        var service = CreateService(out _);
        await service.SignupAsync(new SignupRequest("Ana Silva", "ana@escola.br", "senha-forte-123"), CancellationToken.None);

        var normal = await service.LoginAsync(new LoginRequest("ana@escola.br", "senha-forte-123", RememberMe: false), CancellationToken.None);
        var remembered = await service.LoginAsync(new LoginRequest("ana@escola.br", "senha-forte-123", RememberMe: true), CancellationToken.None);

        Assert.True(remembered.ExpiresIn > normal.ExpiresIn);
    }
}
