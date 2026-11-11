// Migracao 001 — embute `match_participants` dentro de `matches.participants[]` (schemaVersion 1 -> 2).
//
// A API nao le mais `match_participants`: partidas gravadas na versao 1 aparecem sem participantes
// ate esta migracao rodar. Ela e idempotente — so toca documentos com schemaVersion < 2 — e pode ser
// repetida sem efeito colateral.
//
// Uso (fora do /docker-entrypoint-initdb.d de proposito: aquilo roda so no primeiro boot):
//   docker compose exec -T mongo mongosh -u "$MONGO_USER" -p "$MONGO_PASSWORD" \
//     --authenticationDatabase admin "${MONGO_DB:-codex}" < mongo/migrations/001-embed-participants.js
//
// Para apagar a colecao antiga ao final, troque DROP_LEGACY_COLLECTION para true. Ela so e apagada
// se nenhuma partida tiver ficado na versao 1.

const DROP_LEGACY_COLLECTION = false;

const legacy = db.getCollectionNames().includes("match_participants");
if (!legacy) {
  print("match_participants nao existe — nada a migrar.");
  quit(0);
}

const pending = db.matches.countDocuments({ schemaVersion: { $lt: 2 } });
print(`Partidas na versao 1: ${pending}`);

db.matches.aggregate([
  { $match: { schemaVersion: { $lt: 2 } } },
  {
    $lookup: {
      from: "match_participants",
      localField: "_id",
      foreignField: "matchId",
      pipeline: [
        // A mesma ordem do podio que o MatchDocumentWriter grava.
        { $sort: { totalScore: -1, totalElapsedSeconds: 1, joinedAt: 1 } },
        // Campos que eram do documento avulso e agora pertencem ao documento pai.
        { $project: { _id: 0, matchId: 0, schemaVersion: 0 } },
      ],
      as: "participants",
    },
  },
  { $set: { schemaVersion: 2 } },
  { $merge: { into: "matches", on: "_id", whenMatched: "replace", whenNotMatched: "discard" } },
]);

const remaining = db.matches.countDocuments({ schemaVersion: { $lt: 2 } });
print(`Partidas migradas: ${pending - remaining}. Restantes na versao 1: ${remaining}`);

// O indice multikey do historico do jogador e criado pela API na primeira operacao; criar aqui
// tambem so adianta o trabalho (createIndex e idempotente).
db.matches.createIndex({ "participants.userId": 1, finishedAt: -1 });

if (DROP_LEGACY_COLLECTION) {
  if (remaining === 0) {
    db.match_participants.drop();
    print("match_participants apagada.");
  } else {
    print("match_participants mantida: ainda ha partidas na versao 1.");
  }
} else {
  print("match_participants mantida (DROP_LEGACY_COLLECTION = false).");
}
