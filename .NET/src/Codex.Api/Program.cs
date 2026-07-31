using System.Text.Json;
using System.Text.Json.Serialization;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Data;
using Codex.Api.Domain.Entities;
using Codex.Api.Endpoints;
using Codex.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

// Enums do contrato saem como string camelCase (ex.: UserPlan.Intermediate -> "intermediate"),
// espelhando api-rest.md. Excecao conhecida: valores kebab-case como "self-paced" precisarao
// de tratamento a parte quando os endpoints de partida forem implementados (ver api-init.md).
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
});

builder.Services.AddDataProtection()
    .PersistKeysToDbContext<AppDbContext>();

builder.Services.AddSingleton<ISessionTokenService, SessionTokenService>();
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddScoped<AuthService>();

builder.Services
    .AddAuthentication(CodexSessionAuthenticationHandler.SchemeName)
    .AddScheme<AuthenticationSchemeOptions, CodexSessionAuthenticationHandler>(CodexSessionAuthenticationHandler.SchemeName, _ => { });
builder.Services.AddAuthorization();

builder.Services.AddExceptionHandler<ApiExceptionHandler>();
// Exigido pelo pipeline mesmo com um IExceptionHandler custom que sempre trata a excecao
// (UseExceptionHandler() valida essa opcao no startup); ApiExceptionHandler roda primeiro e
// intercepta tudo, entao este ProblemDetails nunca chega a ser usado de fato.
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi();

var app = builder.Build();

app.UseExceptionHandler();

// x-service-token roda antes de tudo: nenhuma rota (exceto /health) atende chamada que nao
// venha do servidor do Next (api-rest.md secao 1).
app.UseMiddleware<ServiceTokenMiddleware>();

app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapSessionEndpoints();
app.MapAuthEndpoints();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.Run();
