namespace Codex.Api.Common.Formatting;

/// <summary>
/// Rotulos de data e duracao ja prontos para a tela.
///
/// api-rest.md secao 2 e 5 sao explicitas sobre isso: "playedAtLabel e durationLabel vem
/// prontos, como updatedLabel em /phase-sets. O front nao carrega biblioteca de datas." Ou
/// seja, formatar aqui nao e conveniencia — e parte do contrato.
///
/// Duas consequencias de o projeto rodar com InvariantGlobalization:
/// - os nomes de mes sao uma tabela literal, nao CultureInfo("pt-BR") (que lancaria);
/// - o fuso e um deslocamento fixo (CodexApi:DisplayUtcOffsetHours, padrao -3 = horario de
///   Brasilia), nao um TimeZoneInfo por id IANA (que depende do ICU, ausente aqui). Enquanto o
///   produto for pt-BR isso e exato: o Brasil nao tem horario de verao desde 2019. Se um dia
///   houver usuario em pais com DST, o conserto e trocar isto por TimeZoneInfo e desligar o
///   InvariantGlobalization — nenhum chamador muda.
/// </summary>
public sealed class LabelFormatter(IConfiguration configuration)
{
    private static readonly string[] MonthAbbreviations =
        ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

    /// <summary>Depois disso "ha N dias" perde a graca e vira data absoluta.</summary>
    private static readonly TimeSpan RelativeCutoff = TimeSpan.FromDays(30);

    private readonly TimeSpan _displayOffset =
        TimeSpan.FromHours(configuration.GetValue("CodexApi:DisplayUtcOffsetHours", -3.0));

    /// <summary>Ex.: "28 jul 2026 · 14:32" (formato de playedAtLabel na secao 2).</summary>
    public string DateTimeLabel(DateTimeOffset instant)
    {
        var local = instant.ToOffset(_displayOffset);
        return $"{local.Day} {MonthAbbreviations[local.Month - 1]} {local.Year} · {local.Hour:D2}:{local.Minute:D2}";
    }

    /// <summary>Ex.: "editado ha 2 dias" (formato de updatedLabel na secao 5).</summary>
    public string EditedLabel(DateTimeOffset updatedAt, DateTimeOffset? now = null)
    {
        // Relogio do banco adiantado em relacao ao do processo produziria "ha -1 minuto".
        var elapsed = (now ?? DateTimeOffset.UtcNow) - updatedAt;
        if (elapsed < TimeSpan.Zero)
        {
            elapsed = TimeSpan.Zero;
        }

        if (elapsed < TimeSpan.FromMinutes(1))
        {
            return "editado agora";
        }

        if (elapsed < TimeSpan.FromHours(1))
        {
            return $"editado há {Plural(elapsed.TotalMinutes, "minuto", "minutos")}";
        }

        if (elapsed < TimeSpan.FromDays(1))
        {
            return $"editado há {Plural(elapsed.TotalHours, "hora", "horas")}";
        }

        if (elapsed < RelativeCutoff)
        {
            return $"editado há {Plural(elapsed.TotalDays, "dia", "dias")}";
        }

        var local = updatedAt.ToOffset(_displayOffset);
        return $"editado em {local.Day} {MonthAbbreviations[local.Month - 1]} {local.Year}";
    }

    /// <summary>Ex.: "32 min", "1 h 12 min" (formato de durationLabel na secao 2).</summary>
    public static string DurationLabel(TimeSpan duration)
    {
        if (duration < TimeSpan.FromMinutes(1))
        {
            // Arredondar para "0 min" faria a linha do historico parecer um bug.
            return "menos de 1 min";
        }

        var totalMinutes = (int)duration.TotalMinutes;
        var hours = totalMinutes / 60;
        var minutes = totalMinutes % 60;

        return (hours, minutes) switch
        {
            (0, _) => $"{minutes} min",
            (_, 0) => $"{hours} h",
            _ => $"{hours} h {minutes} min",
        };
    }

    private static string Plural(double value, string singular, string plural)
    {
        var rounded = (int)value;
        return $"{rounded} {(rounded == 1 ? singular : plural)}";
    }
}
