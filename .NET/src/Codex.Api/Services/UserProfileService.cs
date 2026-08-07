using System.Security.Claims;
using Codex.Api.Common.Auth;
using Codex.Api.Common.Errors;
using Codex.Api.Common.Formatting;
using Codex.Api.Contracts;
using Codex.Api.Contracts.PhaseSets;
using Codex.Api.Contracts.Users;
using Codex.Api.Data;
using Codex.Api.Data.Configurations;
using Codex.Api.Domain;
using Codex.Api.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Codex.Api.Services;

/// <summary>
/// api-rest.md secao 2: PATCH /users/me (dialogo "Editar perfil") e GET /users/{userId}/profile
/// (a tela de perfil inteira).
/// </summary>
public class UserProfileService(AppDbContext db, LabelFormatter labels)
{
    private const int MaxNameLength = 120;
    private const int MaxEmailLength = 256;

    /// <summary>
    /// O contrato nao pagina o historico e a tela nao tem "carregar mais", entao o corte fica
    /// aqui: um professor com tres anos de aulas nao pode transformar a abertura do perfil numa
    /// resposta de megabytes. Quando existir paginacao (ou a tela de relatorios da secao 11),
    /// este numero vira um parametro.
    /// </summary>
    private const int MaxHistoryEntries = 50;

    /// <summary>
    /// PATCH /users/me. Os tres campos sao independentes e opcionais.
    ///
    /// Exige conta pelo motivo obvio — "me" nao existe para convidado. Um participante sem conta
    /// recebe ACCOUNT_REQUIRED, nao 401: o front so abre este dialogo para quem esta logado,
    /// entao chegar aqui sem userId e bug de integracao, e o code descreve o que falta.
    /// </summary>
    public async Task<UserDto> UpdateMeAsync(UpdateUserRequest request, ClaimsPrincipal principal, CancellationToken ct)
    {
        var userId = principal.GetUserId() ?? throw AccountRequired();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct) ?? throw AccountRequired();

        if (request.Name is not null)
        {
            var name = request.Name.Trim();
            if (name.Length is 0 || name.Length > MaxNameLength)
            {
                throw Validation($"name deve ter entre 1 e {MaxNameLength} caracteres.");
            }

            user.Name = name;
        }

        if (request.Email is not null)
        {
            var email = request.Email.Trim();
            if (!IsPlausibleEmail(email))
            {
                throw Validation("email invalido.");
            }

            // A comparacao e exata porque o login tambem compara exato (AuthService): normalizar
            // so aqui criaria um email que troca de dono entre as duas rotas.
            if (email != user.Email && await db.Users.AnyAsync(u => u.Email == email && u.Id != userId, ct))
            {
                throw EmailTaken();
            }

            user.Email = email;
        }

        if (request.AvatarIndex is { } avatarIndex)
        {
            // Mesmo criterio do POST de participante: so o piso e checado. A paleta do front tem
            // 6 avatares hoje, mas cravar 6 aqui faria a API precisar de deploy para acompanhar
            // um arquivo de UI.
            if (avatarIndex < 0)
            {
                throw Validation("avatarIndex deve ser maior ou igual a zero.");
            }

            user.AvatarIndex = avatarIndex;
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException exception) when (IsDuplicateEmail(exception))
        {
            // Mesma corrida do USERNAME_TAKEN: o AnyAsync acima e um SELECT antes de um UPDATE.
            // Quem decide de fato e o indice unico de users.Email.
            throw EmailTaken();
        }

        return AuthService.ToDto(user);
    }

    /// <summary>
    /// GET /users/{userId}/profile.
    ///
    /// "userId aceita o literal 'me', que a API resolve pela sessao — e a mesma rota porque quem
    /// decide o que e publico e o servidor, nao o front" (secao 2). O que muda entre olhar o
    /// proprio perfil e o de outra pessoa esta todo concentrado no <c>isSelf</c> abaixo.
    /// </summary>
    public async Task<LeaderProfileResponse> GetProfileAsync(string userId, ClaimsPrincipal principal, CancellationToken ct)
    {
        var id = ResolveUserId(userId, principal);
        var isSelf = principal.GetUserId() == id;

        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id, ct)
                   ?? throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.UserNotFound, "Usuario nao encontrado.");

        return new LeaderProfileResponse(
            // "Num perfil de outra pessoa, email pode vir vazio" (secao 2). Vem: email nao
            // aparece em pixel nenhum de perfil alheio, e mandar assim mesmo o exporia a qualquer
            // um que soubesse um id.
            AuthService.ToDto(user, includeEmail: isSelf),
            await GetSetsAsync(user, isSelf, ct),
            await GetMatchHistoryAsync(id, ct));
    }

    /// <summary>
    /// "Conjuntos de autoria da pessoa, mais recentes primeiro."
    ///
    /// Num perfil alheio so saem os publicados na comunidade — um rascunho privado nao vira
    /// publico so porque alguem abriu o link do autor. A consequencia e que o mesmo conjunto sai
    /// como "owned" (com updatedLabel) para o dono e como "community" (com authorName) para os
    /// outros, que e exatamente a distincao que PhaseSetSummary faz na secao 5.
    /// </summary>
    private async Task<IReadOnlyList<PhaseSetSummaryDto>> GetSetsAsync(User user, bool isSelf, CancellationToken ct)
    {
        var query = db.PhaseSets.AsNoTracking().Where(s => s.OwnerId == user.Id);

        if (!isSelf)
        {
            query = query.Where(s => s.Visibility == PhaseSetVisibility.Community);
        }

        var sets = await query
            .OrderByDescending(s => s.UpdatedAt)
            .Select(s => new { s.Id, s.Title, s.UpdatedAt, PhaseCount = s.Phases.Count })
            .ToListAsync(ct);

        return sets.Select(s => new PhaseSetSummaryDto(
                s.Id,
                s.Title,
                s.PhaseCount,
                isSelf ? PhaseSetSource.Owned : PhaseSetSource.Community,
                isSelf ? labels.EditedLabel(s.UpdatedAt) : null,
                isSelf ? null : user.Name))
            .ToList();
    }

    /// <summary>
    /// Historico de partidas conduzidas: partidas ja encerradas das salas em que a pessoa e
    /// lider, mais recentes primeiro.
    ///
    /// Sai vazio hoje porque nada cria Match ainda (secao 7 nao tem endpoint). Os agregados foram
    /// escritos mesmo assim, e nao deixados como placeholder, porque todo o dado de que precisam
    /// ja existe no schema — o dia em que POST /rooms/{code}/match existir, esta lista acende
    /// sozinha.
    /// </summary>
    private async Task<IReadOnlyList<LeaderMatchSummaryDto>> GetMatchHistoryAsync(Guid userId, CancellationToken ct)
    {
        var matches = await db.Matches
            .AsNoTracking()
            .Where(m => m.Room.LeaderUserId == userId && m.FinishedAt != null)
            .OrderByDescending(m => m.FinishedAt)
            .Take(MaxHistoryEntries)
            .Select(m => new
            {
                m.Id,
                m.Mode,
                m.StartedAt,
                m.FinishedAt,
                SetTitles = m.Room.QueueSets.OrderBy(s => s.OrderIndex).Select(s => s.Title).ToList(),
                // Quem foi aprovado e quem a tela chama de "participante"; pendente nunca jogou.
                ParticipantCount = m.Room.Participants.Count(p => p.Status == ParticipantStatus.Approved),
                ScoreSum = m.Submissions.Sum(s => s.Score),
                GradedCount = m.Submissions.Count(s => s.Grading == GradingStatus.Graded),
                CorrectCount = m.Submissions.Count(s => s.Correct == true),
            })
            .ToListAsync(ct);

        return matches.Select(m => new LeaderMatchSummaryDto(
                m.Id,
                LabelFormatter.SetTitleLabel(m.SetTitles),
                m.Mode,
                labels.DateTimeLabel(m.FinishedAt!.Value),
                m.ParticipantCount,
                // Media por pessoa, nao por resposta: e o mesmo numero que
                // GET /matches/{id}/scoreboard/me chama de avgScore, e a tela mostra "pts".
                Average(m.ScoreSum ?? 0, m.ParticipantCount),
                // Sobre o que foi corrigido, nao sobre o que foi enviado: uma resposta de IA ainda
                // pendente nao conta como erro.
                Percentage(m.CorrectCount, m.GradedCount),
                LabelFormatter.DurationLabel(m.FinishedAt!.Value - m.StartedAt)))
            .ToList();
    }

    private static int Average(int total, int count) => count is 0 ? 0 : (int)Math.Round((double)total / count);

    private static int Percentage(int part, int total) => total is 0 ? 0 : (int)Math.Round(part * 100.0 / total);

    private static Guid ResolveUserId(string userId, ClaimsPrincipal principal)
    {
        if (string.Equals(userId, "me", StringComparison.OrdinalIgnoreCase))
        {
            return principal.GetUserId() ?? throw AccountRequired();
        }

        // Id malformado e 404 e nao 400: para quem esta olhando, um id que nao da para resolver e
        // um perfil que nao existe — e o front so monta esse link a partir de um id que a API deu.
        return Guid.TryParse(userId, out var parsed)
            ? parsed
            : throw new ApiException(StatusCodes.Status404NotFound, ErrorCodes.UserNotFound, "Usuario nao encontrado.");
    }

    /// <summary>
    /// Deliberadamente frouxo: validar email de verdade e trabalho do envio de confirmacao, nao
    /// de uma regex. O que se impede aqui e o que quebraria a tela — vazio, sem "@", com espaco,
    /// ou maior que a coluna.
    /// </summary>
    private static bool IsPlausibleEmail(string email)
    {
        if (email.Length is 0 || email.Length > MaxEmailLength || email.Any(char.IsWhiteSpace))
        {
            return false;
        }

        var at = email.IndexOf('@');
        return at > 0 && at == email.LastIndexOf('@') && at < email.Length - 1;
    }

    private static bool IsDuplicateEmail(DbUpdateException exception)
        => exception.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: UserConfiguration.UniqueEmailIndex,
        };

    private static ApiException AccountRequired()
        => new(StatusCodes.Status403Forbidden, ErrorCodes.AccountRequired, "E preciso estar logado para acessar o proprio perfil.");

    private static ApiException EmailTaken()
        => new(StatusCodes.Status409Conflict, ErrorCodes.EmailTaken, "Ja existe uma conta com este email.");

    private static ApiException Validation(string message)
        => new(StatusCodes.Status400BadRequest, ErrorCodes.ValidationError, message);
}
