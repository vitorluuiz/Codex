using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Codex.Api.Data.Configurations;

public class SubmissionConfiguration : IEntityTypeConfiguration<Submission>
{
    public void Configure(EntityTypeBuilder<Submission> builder)
    {
        builder.ToTable("submissions");

        builder.Property(s => s.Grading).HasConversion<string>().HasMaxLength(16);
        builder.Property(s => s.AnswerJson).HasColumnType("jsonb").IsRequired();
        builder.Property(s => s.AiSuggestionsJson).HasColumnType("jsonb");
        builder.Property(s => s.TestsPassedJson).HasColumnType("jsonb");

        builder.HasOne(s => s.Match)
            .WithMany(m => m.Submissions)
            .HasForeignKey(s => s.MatchId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(s => s.RoomQueuePhase)
            .WithMany(p => p.Submissions)
            .HasForeignKey(s => s.RoomQueuePhaseId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(s => s.Participant)
            .WithMany(p => p.Submissions)
            .HasForeignKey(s => s.ParticipantId)
            .OnDelete(DeleteBehavior.Cascade);

        // Decisao 2 da secao 13: "1 envio por pessoa por fase" garantido pelo banco.
        //
        // MatchId entra na chave, e nao e detalhe: no Firestore do contrato o documento mora em
        // matches/{matchId}/phases/{phaseId}/submissions/{participantId}, entao "uma vez" sempre foi
        // "uma vez por partida". A traducao relacional inicial perdeu esse escopo, e sem ele a
        // segunda partida da mesma sala (o lider volta ao lobby e recomeca) recusaria no banco o
        // primeiro envio de quem ja tinha jogado aquela fase — um 500, e so em Postgres, porque o
        // InMemory dos testes nao tem indice.
        builder.HasIndex(s => new { s.MatchId, s.RoomQueuePhaseId, s.ParticipantId }).IsUnique();

        // Histograma/podio ordenam por score dentro da fase de uma partida.
        builder.HasIndex(s => new { s.MatchId, s.RoomQueuePhaseId, s.Score });
    }
}
