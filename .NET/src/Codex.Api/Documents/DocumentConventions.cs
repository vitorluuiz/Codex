using System.Text.Json;
using Codex.Api.Domain;
using MongoDB.Bson;
using MongoDB.Bson.IO;
using MongoDB.Bson.Serialization;
using MongoDB.Bson.Serialization.Conventions;
using MongoDB.Bson.Serialization.Serializers;

namespace Codex.Api.Documents;

/// <summary>
/// Como os documentos sao escritos no BSON.
///
/// <b>Uma so grafia para cada valor, em todo o sistema.</b> O Postgres grava enum em PascalCase
/// (<c>Quiz</c>) enquanto o mesmo valor aparece em minuscula dentro do <c>AnswerJson</c> da linha
/// ao lado (<c>"quiz"</c>) — duas grafias do mesmo valor no mesmo banco, e o detalhe mais facil de
/// errar numa query manual. O store de documentos nasce depois disso e nao repete o erro: ele usa
/// <b>exatamente</b> o vocabulario do contrato HTTP/WebSocket, inclusive o kebab-case que so o
/// <see cref="MatchMode"/> tem. Quem abrir o Mongo le o que a tela mostra.
///
/// <c>DocumentVocabularyTests</c> trava isso: para cada valor de cada enum, a grafia do BSON e a
/// grafia do JSON tem que ser a mesma string.
/// </summary>
public static class DocumentConventions
{
    private static readonly Lock Gate = new();
    private static bool _registered;

    public static void Register()
    {
        lock (Gate)
        {
            if (_registered)
            {
                return;
            }

            // Nomes de campo em camelCase e nulo omitido: o BSON sai com a mesma forma do JSON do
            // contrato, entao um documento de fase quiz nao guarda sete campos vazios de outros
            // kinds — a mesma politica de PhaseContent.
            ConventionRegistry.Register(
                "codex",
                new ConventionPack
                {
                    new CamelCaseElementNameConvention(),
                    new IgnoreIfNullConvention(true),
                },
                _ => true);

            // Guid como UUID padrao (subtipo 4), e nao o legado do driver: e o que qualquer outro
            // cliente do Mongo le sem configuracao, e mantem os UUID v7 da aplicacao ordenaveis.
            BsonSerializer.RegisterSerializer(new GuidSerializer(GuidRepresentation.Standard));

            // Decimal128 e nao string: PointsMultiplier entra no calculo da nota, e um numero
            // guardado como texto nao e agregavel nem comparavel do lado do banco.
            BsonSerializer.RegisterSerializer(new DecimalSerializer(BsonType.Decimal128));

            BsonSerializer.RegisterSerializer(new NamedEnumSerializer<MatchMode>(JsonNamingPolicy.KebabCaseLower));
            BsonSerializer.RegisterSerializer(new NamedEnumSerializer<PhaseKind>(JsonNamingPolicy.CamelCase));
            BsonSerializer.RegisterSerializer(new NamedEnumSerializer<GradingStatus>(JsonNamingPolicy.CamelCase));

            _registered = true;
        }
    }
}

/// <summary>
/// Enum como string, com a mesma politica de nomes que o <c>JsonStringEnumConverter</c> do
/// contrato usa. O mapa e montado uma vez por tipo, na construcao.
///
/// Leitura tolerante a caixa: um documento gravado por uma versao anterior — ou a mao, no shell do
/// Mongo — nao deve derrubar o historico inteiro de alguem por causa de uma maiuscula.
/// </summary>
public sealed class NamedEnumSerializer<T> : StructSerializerBase<T>
    where T : struct, Enum
{
    private readonly Dictionary<T, string> _names;
    private readonly Dictionary<string, T> _values;

    public NamedEnumSerializer(JsonNamingPolicy policy)
    {
        _names = Enum.GetValues<T>().ToDictionary(value => value, value => policy.ConvertName(value.ToString()));
        _values = new Dictionary<string, T>(StringComparer.OrdinalIgnoreCase);

        foreach (var (value, name) in _names)
        {
            _values[name] = value;
        }
    }

    public string NameOf(T value) => _names[value];

    public override void Serialize(BsonSerializationContext context, BsonSerializationArgs args, T value)
        => context.Writer.WriteString(_names[value]);

    public override T Deserialize(BsonDeserializationContext context, BsonDeserializationArgs args)
    {
        var type = context.Reader.GetCurrentBsonType();
        if (type is not BsonType.String)
        {
            throw new FormatException($"{typeof(T).Name} esperava uma string no BSON, veio {type}.");
        }

        var name = context.Reader.ReadString();
        return _values.TryGetValue(name, out var value)
            ? value
            : throw new FormatException($"\"{name}\" nao e um valor de {typeof(T).Name}.");
    }
}
