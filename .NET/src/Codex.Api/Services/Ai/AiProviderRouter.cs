using System.Collections.Concurrent;
using Codex.Api.Common.Errors;
using Codex.Api.Domain;

namespace Codex.Api.Services.Ai;

/// <summary>
/// Resolve qual perfil de provedor atende o plano do usuario e controla a concorrencia por perfil
/// via <see cref="SemaphoreSlim"/> (evita empilhar dezenas de requisicoes simultaneas no LM Studio).
/// </summary>
public sealed class AiProviderRouter(AiOptions options)
{
    private static readonly TimeSpan SemaphoreWaitTimeout = TimeSpan.FromSeconds(10);
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _semaphores = new(StringComparer.OrdinalIgnoreCase);

    public (string Name, AiProviderOptions Provider) Resolve(UserPlan plan)
    {
        if (!options.Enabled)
        {
            throw NotConfigured();
        }

        var primaryName = options.GetProviderNameFor(plan);
        if (TryGetConfiguredProvider(primaryName, out var primary))
        {
            return (primaryName, primary);
        }

        if (!string.IsNullOrWhiteSpace(options.FallbackProvider) &&
            TryGetConfiguredProvider(options.FallbackProvider, out var fallback))
        {
            return (options.FallbackProvider.Trim(), fallback);
        }

        throw NotConfigured();
    }

    public bool TryGetFallback(string currentProviderName, out string fallbackName, out AiProviderOptions fallbackProvider)
    {
        if (!string.IsNullOrWhiteSpace(options.FallbackProvider) &&
            !string.Equals(options.FallbackProvider.Trim(), currentProviderName, StringComparison.OrdinalIgnoreCase) &&
            TryGetConfiguredProvider(options.FallbackProvider, out var found))
        {
            fallbackName = options.FallbackProvider.Trim();
            fallbackProvider = found;
            return true;
        }

        fallbackName = string.Empty;
        fallbackProvider = null!;
        return false;
    }

    public async Task<IAsyncDisposable> AcquireSlotAsync(string providerName, AiProviderOptions provider, CancellationToken ct)
    {
        var maxConcurrency = Math.Max(1, provider.MaxConcurrency);
        var semaphore = _semaphores.GetOrAdd(providerName, _ => new SemaphoreSlim(maxConcurrency, maxConcurrency));

        var acquired = await semaphore.WaitAsync(SemaphoreWaitTimeout, ct);
        if (!acquired)
        {
            throw new ApiException(
                StatusCodes.Status503ServiceUnavailable,
                ErrorCodes.AiBusy,
                "O modelo de IA esta atendendo outras solicitacoes no momento. Tente novamente em alguns instantes.");
        }

        return new SemaphoreLease(semaphore);
    }

    private bool TryGetConfiguredProvider(string name, out AiProviderOptions provider)
    {
        foreach (var (key, candidate) in options.Providers)
        {
            if (string.Equals(key, name.Trim(), StringComparison.OrdinalIgnoreCase) && candidate.IsConfigured)
            {
                provider = candidate;
                return true;
            }
        }

        provider = null!;
        return false;
    }

    private static ApiException NotConfigured() => new(
        StatusCodes.Status501NotImplemented,
        ErrorCodes.AiNotConfigured,
        "A geracao por IA nao esta configurada para o seu plano nesta instalacao.");

    private sealed class SemaphoreLease(SemaphoreSlim semaphore) : IAsyncDisposable
    {
        private int _disposed;

        public ValueTask DisposeAsync()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                semaphore.Release();
            }

            return ValueTask.CompletedTask;
        }
    }
}
