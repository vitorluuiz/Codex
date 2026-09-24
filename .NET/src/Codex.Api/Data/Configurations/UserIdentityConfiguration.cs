using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Codex.Api.Data.Configurations;

public class UserIdentityConfiguration : IEntityTypeConfiguration<UserIdentity>
{
    /// <summary>Nome fixo porque OAuthService traduz a violacao desta constraint na corrida de dois logins simultaneos do mesmo provedor.</summary>
    public const string UniqueProviderSubjectIndex = "ix_user_identities_provider_subject_unique";

    public void Configure(EntityTypeBuilder<UserIdentity> builder)
    {
        builder.ToTable("user_identities");

        builder.Property(i => i.Provider).HasConversion<string>().HasMaxLength(16);
        builder.Property(i => i.ProviderUserId).HasMaxLength(128).IsRequired();
        builder.Property(i => i.Email).HasMaxLength(256);

        builder.HasOne(i => i.User)
            .WithMany(u => u.Identities)
            .HasForeignKey(i => i.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(i => new { i.Provider, i.ProviderUserId })
            .IsUnique()
            .HasDatabaseName(UniqueProviderSubjectIndex);
    }
}
