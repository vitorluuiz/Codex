using System.Threading.RateLimiting;
using Codex.Api.Common.Errors;
using Codex.Api.Contracts;
using Microsoft.AspNetCore.RateLimiting;

namespace Codex.Api.Common.RateLimiting;

/// <summary>
/// RATE_LIMITED (api-rest.md secao 1: "protecao de forca bruta no codigo da sala"). Um codigo
/// de 6 digitos e o unico segredo que protege uma sala; sem limite, o espaco inteiro cai em
/// pouco tempo.
///
/// **Particionado pelo codigo da sala, nao por cliente** — e a limitacao importante desta
/// implementacao. Quem chama e sempre o servidor do Next (secao 1), entao todos os alunos
/// chegam do mesmo IP e limitar por IP puniria a turma inteira junto. Por codigo, uma sala
/// especifica nao pode ser martelada, mas alguem varrendo *muitos* codigos diferentes cai numa
/// particao nova a cada tentativa e passa por baixo. Fechar essa brecha exige identificar o
/// cliente final — o servidor do Next teria que repassar o IP do browser num header, o que nao
/// esta no contrato ainda (ver api-lobby.md).
/// </summary>
public static class RateLimitPolicies
{
    public const string RoomCode = "room-code";

    public static IServiceCollection AddCodexRateLimiter(this IServiceCollection services, IConfiguration configuration)
    {
        var permitPerMinute = configuration.GetValue("CodexApi:RoomCodeAttemptsPerMinute", 30);

        services.AddRateLimiter(options =>
        {
            options.AddPolicy(RoomCode, context =>
            {
                var code = context.Request.RouteValues["code"]?.ToString() ?? "unknown";

                return RateLimitPartition.GetFixedWindowLimiter(code, _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = permitPerMinute,
                    Window = TimeSpan.FromMinutes(1),
                    // Sem fila: quem estourou recebe 429 na hora. Segurar a request em fila so
                    // atrasaria o erro que a UI ja sabe mostrar.
                    QueueLimit = 0,
                });
            });

            // O limitador rejeita antes de qualquer codigo do app rodar, entao ele mesmo precisa
            // escrever o {code, message} do contrato — o ApiExceptionHandler nunca ve isto.
            options.OnRejected = async (context, ct) =>
            {
                context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                await context.HttpContext.Response.WriteAsJsonAsync(
                    new ErrorResponse(ErrorCodes.RateLimited, "Muitas tentativas seguidas. Aguarde alguns segundos."), ct);
            };
        });

        return services;
    }
}
