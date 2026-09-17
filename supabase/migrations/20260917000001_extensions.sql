-- Extensões usadas pelo schema.
-- `pgcrypto` fornece gen_random_uuid(), usado como default de toda chave primária.
create extension if not exists "pgcrypto" with schema extensions;

-- `unaccent` normaliza acentos na geração de slug ("Ação" -> "acao").
create extension if not exists "unaccent" with schema extensions;
