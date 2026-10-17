# Validare tranzacțională IMAGE-SYNC cleanup în TEST

Aceste instrucțiuni sunt exclusiv pentru proiectul izolat
`autorepair-sql-test` (`system_identifier=7692131729119822239`). Nu folosesc
Storage API și nu șterg fișiere.

1. Rulează prin `psql -X -v ON_ERROR_STOP=1` scriptul read-only
   `verify_repair_image_sync_cleanup_rollback_readonly.sql` și salvează cele
   opt rânduri ca baseline. Verificările 1–6 trebuie să fie `PASS`; valorile
   `observed` pentru 7–8 sunt snapshoturile inițiale.
2. Rulează, în aceeași formă `psql -X -v ON_ERROR_STOP=1`,
   `validate_repair_image_sync_cleanup_rollback.sql`. Scriptul conține propriul
   `BEGIN`, verifică din nou fail-closed identitatea TEST înainte de orice DDL
   sau lock și se termină obligatoriu cu `ROLLBACK`. Față de migrarea sursă,
   copia diferă numai prin acest gate TEST-only, comentariul de identificare și
   înlocuirea ultimului `COMMIT` cu `ROLLBACK`.
3. Rulează din nou verificatorul read-only.
4. Acceptă rollback-ul numai dacă:
   - sunt returnate exact opt rânduri;
   - verificările 1–6 sunt `PASS`;
   - hashurile `observed` pentru verificările 7 și 8 sunt identice cu baseline-ul;
   - nu există alte mesaje de eroare.

Comandă recomandată, după configurarea sigură a libpq și `PGPASSFILE`:

```sh
/opt/homebrew/opt/libpq/bin/psql -X -v ON_ERROR_STOP=1 \
  --dbname="$REPAIR_IMAGE_TEST_DATABASE_URL" \
  --file=supabase/tests/verify_repair_image_sync_cleanup_rollback_readonly.sql

/opt/homebrew/opt/libpq/bin/psql -X -v ON_ERROR_STOP=1 \
  --dbname="$REPAIR_IMAGE_TEST_DATABASE_URL" \
  --file=supabase/tests/validate_repair_image_sync_cleanup_rollback.sql

/opt/homebrew/opt/libpq/bin/psql -X -v ON_ERROR_STOP=1 \
  --dbname="$REPAIR_IMAGE_TEST_DATABASE_URL" \
  --file=supabase/tests/verify_repair_image_sync_cleanup_rollback_readonly.sql
```

Nu continua cu instalarea permanentă dacă oricare valoare diferă.
