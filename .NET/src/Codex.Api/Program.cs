using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Common.Formatting;
using Codex.Api.Common.Json;
using Codex.Api.Common.RateLimiting;
using Codex.Api.Data;
using Codex.Api.Documents;
using Codex.Api.Domain.Entities;
using Codex.Api.Endpoints;
using Codex.Api.Services;
using Codex.Api.Services.OAuth;
using Codex.Api.Services.Realtime;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Prometheus;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Default")));

// As regras de serializacao do contrato vivem em CodexJsonOptions porque agora ha dois
// serializadores (HTTP e o publicador de realtime) e eles precisam concordar — o front usa o
// mesmo parser para o corpo do GET e para o payload do WebSocket.
builder.Services.ConfigureHttpJsonOptions(options => CodexJsonOptions.Apply(options.SerializerOptions));

builder.Services.AddDataProtection()
    .PersistKeysToDbContext<AppDbContext>();

builder.Services.AddSingleton<ISessionTokenService, SessionTokenService>();
builder.Services.AddSingleton<IOAuthStateService, OAuthStateService>();
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddSingleton<LabelFormatter>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddCodexOAuth(builder.Configuration);
builder.Services.AddScoped<RoomAccessService>();
builder.Services.AddScoped<RoomQueueService>();
builder.Services.AddScoped<RoomService>();
builder.Services.AddScoped<ParticipantService>();
builder.Services.AddScoped<UserProfileService>();
builder.Services.AddScoped<PhaseSetService>();
builder.Services.AddScoped<MatchAccessService>();
builder.Services.AddScoped<MatchStatsService>();
builder.Services.AddScoped<MatchEventPublisher>();
builder.Services.AddScoped<MatchDocumentWriter>();
builder.Services.AddScoped<MatchService>();
builder.Services.AddScoped<SubmissionService>();

builder.Services.AddCodexRateLimiter(builder.Configuration);
builder.Services.AddCodexRealtime(builder.Configuration);
builder.Services.AddCodexDocuments(builder.Configuration);

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

app.UseHttpMetrics();

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
app.MapPhaseSetEndpoints();
app.MapMatchEndpoints();
app.MapRealtimeEndpoints();
app.MapMetrics();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.Run();
