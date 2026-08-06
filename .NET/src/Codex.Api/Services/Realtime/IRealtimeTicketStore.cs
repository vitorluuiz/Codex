using System.Collections.Concurrent;
using System.Security.Cryptography;
using StackExchange.Redis;

namespace Codex.Api.Services.Realtime;

/// <summary>
/// Tickets de <c>POST /realtime-ticket</c> (websocket-contract.md secao 2): "um token de uso
/// unico valido por 30 s", para quando o cookie nao vai no handshake (iframe, ITP do Safari).
///
/// Guarda ticket -> token de sessao. O servico de WS troca um pelo outro em
/// <c>POST /internal/realtime/resolve</c> e passa a usar o token de sessao dali em diante — ele
/// precisa reler o papel a cada <c>subscribe</c> (secao 10), e um ticket, sendo de uso unico,
/// nao serviria para isso.
/// </summary>
public interface IRealtimeTicketStore
{
    Task<string> IssueAsync(string sessionToken, TimeSpan lifetime, CancellationToken ct);

    /// <summary>Consome o ticket. Segunda chamada com o mesmo valor devolve <c>null</c>.</summary>
    Task<string?> RedeemAsync(string ticket, CancellationToken ct);
}

public static class RealtimeTicket
{
    /// <summary>
    /// 32 bytes de aleatoriedade criptografica. O ticket e uma credencial de sessao completa
    /// durante 30 s — vale o mesmo cuidado do codigo de sala, que ja usa RandomNumberGenerator.
    /// </summary>
    public static string Generate()
        => Base64UrlEncode(RandomNumberGenerator.GetBytes(32));

    public static string Key(string prefix, string ticket) => $"{prefix}ticket:{ticket}";

    private static string Base64UrlEncode(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

public class RedisRealtimeTicketStore(IRealtimeConnection connection, RealtimeOptions options) : IRealtimeTicketStore
{
    public async Task<string> IssueAsync(string sessionToken, TimeSpan lifetime, CancellationToken ct)
    {
        var ticket = RealtimeTicket.Generate();
        var db = (await connection.GetAsync(ct)).GetDatabase();
        await db.StringSetAsync(RealtimeTicket.Key(options.ChannelPrefix, ticket), sessionToken, lifetime);
        return ticket;
    }

    public async Task<string?> RedeemAsync(string ticket, CancellationToken ct)
    {
        var db = (await connection.GetAsync(ct)).GetDatabase();

        // GETDEL: ler e apagar num comando so. Com GET seguido de DEL, dois handshakes
        // simultaneos com o mesmo ticket passariam os dois — que e precisamente o que "uso
        // unico" existe para impedir.
        var stored = await db.StringGetDeleteAsync(RealtimeTicket.Key(options.ChannelPrefix, ticket));
        return stored.IsNullOrEmpty ? null : stored.ToString();
    }
}

/// <summary>
/// Fallback sem Redis. <b>Limitacao conhecida:</b> o ticket so e resgatavel na instancia da API
/// que o emitiu. Com uma instancia (dev, e a implantacao atual) e equivalente ao Redis; com
/// varias atras de um load balancer, um ticket emitido na instancia A falha se o WS perguntar a
/// B. Configure <c>CodexApi:Realtime:RedisConnectionString</c> antes de escalar a API.
/// </summary>
public class InMemoryRealtimeTicketStore : IRealtimeTicketStore
{
    private readonly ConcurrentDictionary<string, (string SessionToken, DateTimeOffset ExpiresAt)> _tickets = new();

    public Task<string> IssueAsync(string sessionToken, TimeSpan lifetime, CancellationToken ct)
    {
        Sweep();
        var ticket = RealtimeTicket.Generate();
        _tickets[ticket] = (sessionToken, DateTimeOffset.UtcNow.Add(lifetime));
        return Task.FromResult(ticket);
    }

    public Task<string?> RedeemAsync(string ticket, CancellationToken ct)
    {
        if (!_tickets.TryRemove(ticket, out var entry))
        {
            return Task.FromResult<string?>(null);
        }

        return Task.FromResult(entry.ExpiresAt > DateTimeOffset.UtcNow ? entry.SessionToken : null);
    }

    private void Sweep()
    {
        if (_tickets.Count < 1_000)
        {
            return;
        }

        var now = DateTimeOffset.UtcNow;
        foreach (var (key, entry) in _tickets)
        {
            if (entry.ExpiresAt <= now)
            {
                _tickets.TryRemove(key, out _);
            }
        }
    }
}
