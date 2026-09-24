namespace Codex.Api.Documents;

/// <summary>
/// Composicao do store de documentos. E aqui — e so aqui — que "existe Mongo configurado?" e
/// respondido; o resto do codigo grava sempre, sem perguntar. Mesma forma de
/// <c>AddCodexRealtime</c>.
/// </summary>
public static class DocumentServiceCollectionExtensions
{
    public static IServiceCollection AddCodexDocuments(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(DocumentOptions.SectionName).Get<DocumentOptions>() ?? new DocumentOptions();
        services.AddSingleton(options);

        if (options.IsConfigured)
        {
            services.AddSingleton<IMatchDocumentStore, MongoMatchDocumentStore>();
            return services;
        }

        // Ver InMemoryMatchDocumentStore: degradar aqui so vale enquanto o Postgres ainda guarda a
        // partida. No passo 5 isto vira erro de inicializacao.
        services.AddSingleton<IMatchDocumentStore, InMemoryMatchDocumentStore>();
        return services;
    }
}
