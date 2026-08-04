using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Codex.Api.Data.Configurations;

public class UserConfiguration : IEntityTypeConfiguration<User>
{
    /// <summary>Nome fixo porque UserProfileService traduz a violacao desta constraint em EMAIL_TAKEN.</summary>
    public const string UniqueEmailIndex = "IX_users_Email";

    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.ToTable("users");

        builder.Property(u => u.Name).HasMaxLength(120).IsRequired();
        builder.Property(u => u.Email).HasMaxLength(256).IsRequired();
        builder.Property(u => u.PasswordHash).HasMaxLength(256);
        builder.Property(u => u.Plan).HasConversion<string>().HasMaxLength(32);
        builder.Property(u => u.Audience).HasConversion<string>().HasMaxLength(16);

        // Nome default do EF ("IX_users_Email"), fixado numa constante porque UserProfileService
        // traduz a violacao desta constraint de volta em EMAIL_TAKEN (secao 2).
        builder.HasIndex(u => u.Email).IsUnique().HasDatabaseName(UniqueEmailIndex);
    }
}
