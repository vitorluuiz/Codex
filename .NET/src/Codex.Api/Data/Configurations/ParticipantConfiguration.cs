using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Codex.Api.Data.Configurations;

public class ParticipantConfiguration : IEntityTypeConfiguration<Participant>
{
    /// <summary>Nome fixo porque ParticipantService traduz a violacao desta constraint em USERNAME_TAKEN.</summary>
    public const string UniqueDisplayNamePerRoomIndex = "ix_participants_room_display_name_unique";

    public void Configure(EntityTypeBuilder<Participant> builder)
    {
        builder.ToTable("participants");

        builder.Property(p => p.DisplayName).HasMaxLength(80).IsRequired();
        builder.Property(p => p.Status).HasConversion<string>().HasMaxLength(16);

        builder.Property(p => p.DisplayNameNormalized)
            .HasComputedColumnSql("lower(\"DisplayName\")", stored: true);

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

        // USERNAME_TAKEN (secao 3) como garantia do banco, e nao so como SELECT-antes-do-INSERT
        // no servico. Parcial: recusado nao segura o nome, entao fica de fora do indice.
        builder.HasIndex(p => new { p.RoomId, p.DisplayNameNormalized })
            .IsUnique()
            .HasFilter("\"Status\" <> 'Rejected'")
            .HasDatabaseName(UniqueDisplayNamePerRoomIndex);
    }
}
