using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Codex.Api.Common.Json;

/// <summary>
/// Escreve datas como "2026-07-29T14:02:11Z", o formato usado em todos os exemplos do
/// api-rest.md. O padrao do System.Text.Json para DateTimeOffset e "+00:00" no lugar do "Z";
/// os dois sao ISO-8601 valido e o Date do JS aceita ambos, mas o contrato mostra "Z" e nao
/// custa nada cumpri-lo a risca.
///
/// Efeito colateral aceito: a precisao na resposta cai para segundos (nenhum exemplo do doc
/// tem fracao, e nada no front ordena por timestamp — ordenacao e sempre do servidor). O que
/// esta gravado no Postgres continua completo; isto e so a serializacao.
/// </summary>
public class UtcDateTimeOffsetJsonConverter : JsonConverter<DateTimeOffset>
{
    private const string Format = "yyyy-MM-dd'T'HH:mm:ss'Z'";

    public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        => reader.GetDateTimeOffset();

    public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options)
        => writer.WriteStringValue(value.ToUniversalTime().ToString(Format, CultureInfo.InvariantCulture));
}
