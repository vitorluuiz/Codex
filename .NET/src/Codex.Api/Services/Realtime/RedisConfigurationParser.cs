using StackExchange.Redis;

namespace Codex.Api.Services.Realtime;

/// <summary>
/// Traduz a connection string do Redis para <see cref="ConfigurationOptions"/>, aceitando tanto
/// o formato nativo do StackExchange.Redis (<c>localhost:6379</c>) quanto a URL
/// <c>redis://host:porta</c>.
///
/// Existe por causa de uma armadilha silenciosa: <c>ConfigurationOptions.Parse</c> <b>nao
/// rejeita</b> uma URL — ele a interpreta como um host chamado literalmente
/// "redis://localhost" na porta 0, sem lancar nada. E o servico de WS ao lado usa ioredis, que
/// exige justamente o formato de URL. Ou seja: quem copiar o valor de um lado para o outro
/// produz uma API que sobe normalmente, nunca conecta, e cujo unico sintoma e "os eventos nao
/// chegam" — porque falha de publicacao e engolida de proposito (ver
/// <see cref="RedisRealtimeEventPublisher"/>).
///
/// Normalizar aqui e mais barato que documentar a diferenca e torcer.
/// </summary>
public static class RedisConfigurationParser
{
    private const int DefaultPort = 6379;

    public static ConfigurationOptions Parse(string connectionString)
    {
        var raw = connectionString.Trim();

        if (!LooksLikeUrl(raw))
        {
            return ConfigurationOptions.Parse(raw);
        }

        var uri = new Uri(raw);
        var options = new ConfigurationOptions
        {
            // rediss:// e a forma padrao de pedir TLS numa URL de Redis.
            Ssl = uri.Scheme.Equals("rediss", StringComparison.OrdinalIgnoreCase),
        };

        options.EndPoints.Add(uri.Host, uri.IsDefaultPort || uri.Port <= 0 ? DefaultPort : uri.Port);

        if (!string.IsNullOrEmpty(uri.UserInfo))
        {
            // redis://senha@host (sem usuario) e a forma classica; redis://usuario:senha@host e
            // a de ACL do Redis 6+. As duas aparecem em provedores gerenciados.
            var parts = uri.UserInfo.Split(':', 2);
            if (parts.Length == 1)
            {
                options.Password = Uri.UnescapeDataString(parts[0]);
            }
            else
            {
                options.User = Uri.UnescapeDataString(parts[0]);
                options.Password = Uri.UnescapeDataString(parts[1]);
            }
        }

        var path = uri.AbsolutePath.Trim('/');
        if (path.Length > 0 && int.TryParse(path, out var database))
        {
            options.DefaultDatabase = database;
        }

        return options;
    }

    private static bool LooksLikeUrl(string raw)
        => raw.StartsWith("redis://", StringComparison.OrdinalIgnoreCase)
        || raw.StartsWith("rediss://", StringComparison.OrdinalIgnoreCase);
}
