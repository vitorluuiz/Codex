namespace Codex.Api.Documents;

/// <summary>
/// Secao <c>CodexApi:Documents</c> do appsettings — o banco orientado a documentos que guarda as
/// partidas finalizadas (<c>docs/contracts/postgresql/migracao-dados.md</c> secao 5).
///
/// Sem <c>ConnectionString</c> a API sobe e as partidas ficam num store em memoria. E a mesma
/// politica do realtime sem Redis, e vale <b>enquanto o Postgres continuar sendo a fonte da
/// verdade</b> — ou seja, ate o passo 5 da secao 8.2. A partir dali, perder o documento e perder a
/// partida, e a ausencia precisa virar erro de inicializacao.
/// </summary>
public class DocumentOptions
{
    public const string SectionName = "CodexApi:Documents";

    public string? ConnectionString { get; init; }

    public string DatabaseName { get; init; } = "codex";

    /// <summary>Teto de linhas do historico do lider — o mesmo <c>MaxHistoryEntries</c> do perfil.</summary>
    public int MaxHistoryEntries { get; init; } = 50;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ConnectionString);
}
