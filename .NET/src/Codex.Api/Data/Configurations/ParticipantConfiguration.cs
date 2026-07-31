using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Codex.Api.Data.Configurations;

public class ParticipantConfiguration : IEntityTypeConfiguration<Participant>
{
    public void Configure(EntityTypeBuilder<Participant> builder)
    {
        builder.ToTable("participants");

        builder.Property(p => p.DisplayName).HasMaxLength(80).IsRequired();
        builder.Property(p => p.Status).HasConversion<string>().HasMaxLength(16);

        builder.HasOne(p => p.Room)
            .WithMany(r => r.Participants)
            .HasForeignKey(p => p.RoomId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(p => p.User)
            .WithMany()
            .HasForeignKey(p => p.UserId)
            .OnDelete(DeleteBehavior.SetNull);

        // Espelha o indice sugerido na secao 13: status + joinedAt, com RoomId na frente
        // porque no relacional a "subcolecao" e filtrada por essa FK.
        builder.HasIndex(p => new { p.RoomId, p.Status, p.JoinedAt });
    }
}
