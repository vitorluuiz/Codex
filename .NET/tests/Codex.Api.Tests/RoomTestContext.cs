using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Data;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Codex.Api.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Codex.Api.Tests;

/// <summary>
/// Cenario minimo das secoes 3-4: uma sala com lider. Usa EF InMemory, como os testes de auth.
/// Consequencia: o indice unico parcial de nome por sala nao e exercitado aqui (InMemory nao
/// tem indices) — o que estes testes cobrem e a checagem do servico. A constraint em si foi
/// verificada contra o Postgres real.
/// </summary>
public class RoomTestContext
{
    public AppDbContext Db { get; }
    public RoomService Rooms { get; }
    public ParticipantService Participants { get; }
    public ISessionTokenService Tokens { get; }

    public User Leader { get; }
    public Room Room { get; }

    public RoomTestContext(Action<Room>? configureRoom = null)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        Db = new AppDbContext(options);

        Tokens = new SessionTokenService(new EphemeralDataProtectionProvider());
        var configuration = new ConfigurationBuilder().Build();

        var access = new RoomAccessService(Db);
        Rooms = new RoomService(Db, access);
        Participants = new ParticipantService(Db, access, Rooms, Tokens, configuration);

        Leader = new User { Name = "Marina Duarte", Email = "marina@escola.br" };
        Room = new Room
        {
            Code = "482913",
            Capacity = 20,
            LeaderUserId = Leader.Id,
            Leader = Leader,
        };
        configureRoom?.Invoke(Room);

        Db.Users.Add(Leader);
        Db.Rooms.Add(Room);
        Db.SaveChanges();
    }

    public ClaimsPrincipal Anonymous => new(new ClaimsIdentity());

    public ClaimsPrincipal AsLeader => AsUser(Leader.Id);

    public static ClaimsPrincipal AsUser(Guid userId)
        => new(new ClaimsIdentity([new Claim(CodexClaimTypes.UserId, userId.ToString())], "test"));

    public ClaimsPrincipal AsParticipant(Guid participantId)
        => new(new ClaimsIdentity(
            [new Claim(CodexClaimTypes.ParticipantId, participantId.ToString()), new Claim(CodexClaimTypes.RoomCode, Room.Code)],
            "test"));

    /// <summary>Usuario qualquer que existe mas nao e o lider desta sala.</summary>
    public User AddUser(string name, string email)
    {
        var user = new User { Name = name, Email = email };
        Db.Users.Add(user);
        Db.SaveChanges();
        return user;
    }

    public Participant AddParticipant(string displayName, ParticipantStatus status = ParticipantStatus.Approved, Guid? userId = null)
    {
        var participant = new Participant
        {
            RoomId = Room.Id,
            DisplayName = displayName,
            Status = status,
            UserId = userId,
            LoggedIn = userId is not null,
        };
        Db.Participants.Add(participant);
        Db.SaveChanges();
        return participant;
    }
}
