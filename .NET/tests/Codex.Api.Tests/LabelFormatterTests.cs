using Codex.Api.Common.Formatting;
using Microsoft.Extensions.Configuration;

namespace Codex.Api.Tests;

/// <summary>
/// Os rotulos que a secao 2 e a secao 5 exigem que o servidor mande prontos (updatedLabel,
/// playedAtLabel, durationLabel) — o front nao tem biblioteca de datas para consertar um erro
/// daqui.
/// </summary>
public class LabelFormatterTests
{
    private static LabelFormatter Formatter(double utcOffsetHours = -3)
        => new(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CodexApi:DisplayUtcOffsetHours"] = utcOffsetHours.ToString(),
            })
            .Build());

    [Fact]
    public void DateTimeLabel_matches_the_example_of_the_contract()
    {
        // 17:32Z em Brasilia (-3) e 14:32 — o exemplo da secao 2.
        var label = Formatter().DateTimeLabel(new DateTimeOffset(2026, 7, 28, 17, 32, 0, TimeSpan.Zero));

        Assert.Equal("28 jul 2026 · 14:32", label);
    }

    [Fact]
    public void DateTimeLabel_respects_the_configured_offset()
    {
        var label = Formatter(utcOffsetHours: 0).DateTimeLabel(new DateTimeOffset(2026, 7, 28, 17, 32, 0, TimeSpan.Zero));

        Assert.Equal("28 jul 2026 · 17:32", label);
    }

    [Theory]
    [InlineData(0, "editado agora")]
    [InlineData(30, "editado agora")]
    [InlineData(60, "editado há 1 minuto")]
    [InlineData(60 * 5, "editado há 5 minutos")]
    [InlineData(60 * 60, "editado há 1 hora")]
    [InlineData(60 * 60 * 3, "editado há 3 horas")]
    [InlineData(60 * 60 * 24, "editado há 1 dia")]
    [InlineData(60 * 60 * 24 * 2, "editado há 2 dias")]
    public void EditedLabel_is_relative_while_it_is_recent(int elapsedSeconds, string expected)
    {
        var now = new DateTimeOffset(2026, 7, 28, 17, 32, 0, TimeSpan.Zero);

        var label = Formatter().EditedLabel(now.AddSeconds(-elapsedSeconds), now);

        Assert.Equal(expected, label);
    }

    [Fact]
    public void EditedLabel_falls_back_to_an_absolute_date_after_thirty_days()
    {
        var now = new DateTimeOffset(2026, 9, 1, 12, 0, 0, TimeSpan.Zero);

        var label = Formatter().EditedLabel(new DateTimeOffset(2026, 7, 28, 17, 32, 0, TimeSpan.Zero), now);

        Assert.Equal("editado em 28 jul 2026", label);
    }

    [Fact]
    public void EditedLabel_never_goes_negative_on_clock_skew()
    {
        var now = new DateTimeOffset(2026, 7, 28, 17, 32, 0, TimeSpan.Zero);

        var label = Formatter().EditedLabel(now.AddMinutes(5), now);

        Assert.Equal("editado agora", label);
    }

    [Theory]
    [InlineData(0, "menos de 1 min")]
    [InlineData(59, "menos de 1 min")]
    [InlineData(60, "1 min")]
    [InlineData(32 * 60, "32 min")]
    [InlineData(60 * 60, "1 h")]
    [InlineData(72 * 60, "1 h 12 min")]
    public void DurationLabel_covers_the_shapes_the_history_can_show(int seconds, string expected)
    {
        Assert.Equal(expected, LabelFormatter.DurationLabel(TimeSpan.FromSeconds(seconds)));
    }
}
