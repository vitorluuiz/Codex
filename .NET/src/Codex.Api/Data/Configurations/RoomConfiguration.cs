using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Codex.Api.Data.Configurations;

public class RoomConfiguration : IEntityTypeConfiguration<Room>
{
    public void Configure(EntityTypeBuilder<Room> builder)
    {
        builder.ToTable("rooms");

        builder.Property(r => r.Code).HasMaxLength(6).IsRequired();
        builder.Property(r => r.Status).HasConversion<string>().HasMaxLength(16);
        builder.Property(r => r.MatchMode).HasConversion<string>().HasMaxLength(16);

        builder.HasOne(r => r.Leader)
            .WithMany(u => u.LedRooms)
            .HasForeignKey(r => r.LeaderUserId)
            .OnDelete(DeleteBehavior.Restrict);

        // Nao-unico de proposito: codigos de 6 digitos sao reciclados quando a sala expira
        // (secao 13 da doc). Garantir "codigo ativo unico" e responsabilidade da camada de
        // servico que gera o codigo, nao de uma constraint de banco.
        builder.HasIndex(r => r.Code);
    }
}
