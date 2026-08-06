using System.Text.Json;
using System.Text.Json.Serialization;
using Codex.Api.Domain;

namespace Codex.Api.Common.Json;

/// <summary>
/// Os tres desvios que o contrato exige do padrao do ASP.NET Core (camelCase global, MatchMode
/// em kebab-case, datas terminando em Z), num lugar so.
///
/// Estavam inline no Program.cs enquanto o unico serializador era o do HTTP. Com o publicador
/// de realtime existe um segundo: se as duas configuracoes divergissem, o mesmo
/// <c>ParticipantDto</c> sairia com um formato pelo GET e outro pelo WebSocket, e o front — que
/// usa o mesmo parser para os dois (secao 5 do websocket-contract) — quebraria so no caminho do
/// tempo real.
/// </summary>
public static class CodexJsonOptions
{
    public static void Apply(JsonSerializerOptions options)
    {
        options.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;

        // MatchMode e o unico enum do contrato em kebab-case ("self-paced", secao 7). Converters
        // sao avaliados em ordem, entao o especifico vem antes do geral — invertido, o camelCase
        // pegaria MatchMode primeiro e emitiria "selfPaced".
        options.Converters.Add(new JsonStringEnumConverter<MatchMode>(JsonNamingPolicy.KebabCaseLower));
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        options.Converters.Add(new UtcDateTimeOffsetJsonConverter());
    }

    /// <summary>Instancia propria, para quem serializa fora do pipeline HTTP.</summary>
    public static JsonSerializerOptions Create()
    {
        var options = new JsonSerializerOptions();
        Apply(options);
        return options;
    }
}
