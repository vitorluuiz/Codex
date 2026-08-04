using System.Text.Json;
using System.Text.Json.Serialization;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Common.Formatting;
using Codex.Api.Common.Json;
using Codex.Api.Common.RateLimiting;
using Codex.Api.Data;
using Codex.Api.Domain;
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

builder.Services.ConfigureHttpJsonOptions(options =>
{
    // MatchMode e o unico enum do contrato em kebab-case ("self-paced", secao 7) e ja aparece
    // no payload de GET /rooms/{code}. Converters sao avaliados em ordem, entao o especifico
    // vem antes do geral — invertido, o camelCase pegaria MatchMode primeiro e emitiria
    // "selfPaced". Isto resolve a ressalva deixada em api-init.md secao 5.
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter<MatchMode>(JsonNamingPolicy.KebabCaseLower));

    // Enums do contrato saem como string camelCase (ex.: UserPlan.Intermediate -> "intermediate").
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));

    options.SerializerOptions.Converters.Add(new UtcDateTimeOffsetJsonConverter());
});

builder.Services.AddDataProtection()
    .PersistKeysToDbContext<AppDbContext>();

builder.Services.AddSingleton<ISessionTokenService, SessionTokenService>();
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddSingleton<LabelFormatter>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<RoomAccessService>();
builder.Services.AddScoped<RoomQueueService>();
builder.Services.AddScoped<RoomService>();
builder.Services.AddScoped<ParticipantService>();
builder.Services.AddScoped<UserProfileService>();

builder.Services.AddCodexRateLimiter(builder.Configuration);

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

// Depois do roteamento (que o WebApplication insere no inicio do pipeline), senao a particao
// por codigo de sala nao teria RouteValues["code"] para ler.
app.UseRateLimiter();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.MapSessionEndpoints();
app.MapAuthEndpoints();
app.MapUserEndpoints();
app.MapRoomEndpoints();
app.MapParticipantEndpoints();
app.MapRoomQueueEndpoints();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.Run();
