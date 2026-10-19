using System.Collections.Concurrent;
using Codex.Api.Common.Errors;
using Codex.Api.Services.Realtime;
using Codex.Api.Services.Redis;
using StackExchange.Redis;

namespace Codex.Api.Services.Ai;

/// <summary>
/// Trava por usuario (<c>ai:inflight:{userId}</c>) enquanto uma geracao esta em andamento.
/// Serializa a checagem de cota por usuario sem precisar de lock no Postgres e impede varias
/// geracoes simultaneas na mesma conta.
/// </summary>
public interface IAiInflightLock
{
    Task<IAsyncDisposable> AcquireAsync(Guid userId, CancellationToken ct);
}

public sealed class RedisAiInflightLock(IRealtimeConnection connection, AiOptions options) : IAiInflightLock
{
    public async Task<IAsyncDisposable> AcquireAsync(Guid userId, CancellationToken ct)
    {
        var key = RedisKeys.AiInflight(userId.ToString());
        var token = Guid.NewGuid().ToString("N");
        var ttl = TimeSpan.FromSeconds(options.InflightLockSeconds > 0 ? options.InflightLockSeconds : 180);

        var db = (await connection.GetAsync(ct)).GetDatabase();
        var acquired = await db.StringSetAsync(key, token, ttl, When.NotExists);
        if (!acquired)
        {
            throw AiInflightBusy();
        }

        return new RedisLockLease(db, key, token);
    }

    internal static ApiException AiInflightBusy() => new(
        StatusCodes.Status429TooManyRequests,
        ErrorCodes.AiBusy,
        "Ja existe uma geracao por IA em andamento para a sua conta. Aguarde ela terminar.");

    private sealed class RedisLockLease(IDatabase db, string key, string token) : IAsyncDisposable
    {
        private int _disposed;

        public async ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0)
            {
                return;
            }

            try
            {
                var current = await db.StringGetAsync(key);
                if (current == token)
                {
                    await db.KeyDeleteAsync(key);
                }
            }
            catch
            {
                // Se o Redis cair antes do release, o TTL de InflightLockSeconds libera a chave.
            }
        }
    }
}

/// <summary>Fallback em memoria quando o Redis nao esta configurado (dev local sem Redis e testes).</summary>
public sealed class InMemoryAiInflightLock(AiOptions options) : IAiInflightLock
{
    private readonly ConcurrentDictionary<Guid, (string Token, DateTimeOffset ExpiresAt)> _locks = new();

    public Task<IAsyncDisposable> AcquireAsync(Guid userId, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var ttl = TimeSpan.FromSeconds(options.InflightLockSeconds > 0 ? options.InflightLockSeconds : 180);
        var token = Guid.NewGuid().ToString("N");

        while (true)
        {
            if (_locks.TryGetValue(userId, out var existing))
            {
                if (existing.ExpiresAt > now)
                {
                    throw RedisAiInflightLock.AiInflightBusy();
                }

                _locks.TryRemove(KeyValuePair.Create(userId, existing));
            }

            var entry = (token, now.Add(ttl));
            if (_locks.TryAdd(userId, entry))
            {
                return Task.FromResult<IAsyncDisposable>(new InMemoryLease(_locks, userId, entry));
            }
        }
    }

    private sealed class InMemoryLease(
        ConcurrentDictionary<Guid, (string Token, DateTimeOffset ExpiresAt)> locks,
        Guid userId,
        (string Token, DateTimeOffset ExpiresAt) entry) : IAsyncDisposable
    {
        private int _disposed;

        public ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                locks.TryRemove(KeyValuePair.Create(userId, entry));
            }

            return ValueTask.CompletedTask;
        }
    }
}
