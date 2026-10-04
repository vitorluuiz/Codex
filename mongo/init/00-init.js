// Executado no primeiro boot pelo entrypoint oficial do MongoDB (/docker-entrypoint-initdb.d).
// MONGO_INITDB_ROOT_USERNAME / MONGO_INITDB_ROOT_PASSWORD / MONGO_INITDB_DATABASE ja
// inicializam as credenciais administrativas e o banco padrao configurados no ambiente.
// Este script serve como ponto de extensao para configuracoes adicionais,
// colecoes ou indices customizados caso necessario no futuro.
