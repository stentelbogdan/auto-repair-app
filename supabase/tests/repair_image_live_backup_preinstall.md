# Backup LIVE înainte de instalarea Repair Image Registry

Acest document pregătește operațiile manuale. Nu autorizează conectarea la LIVE,
restaurarea peste LIVE/TEST sau copierea obiectelor Storage.

## Identități obligatorii

- LIVE project ref: `ouoiykudvcoqbkybkqvs`
- LIVE PostgreSQL `system_identifier`: `7623125441096521075`
- TEST `system_identifier` interzis: `7692131729119822239`
- database: `postgres`
- rol server-side așteptat după conectare: `postgres`

Conexiunea se ia exclusiv din dialogul **Connect** al proiectului LIVE. Se poate
folosi endpointul direct dacă rețeaua suportă IPv6 sau Session Pooler pe 5432.
Hostname-ul, portul și userul se păstrează în variabile locale neverisionate.
Parola se păstrează numai într-un `PGPASSFILE` cu permisiuni `0600`.

## 1. Restore point administrat de Supabase

În Dashboard-ul proiectului LIVE, la **Database > Backups**:

1. se confirmă tipul disponibil: daily physical backup sau PITR;
2. se notează identificatorul și timestampul ultimului restore point anterior
   ferestrei de instalare;
3. se verifică intervalul de retenție și faptul că restore point-ul este marcat
   disponibil;
4. pentru PITR se notează ultimul recovery point înainte de instalare;
5. nu se pornește restaurarea.

Un restore point din Dashboard este backup PostgreSQL. El include metadata din
`storage.objects`, dar nu conținutul binar al obiectelor Storage. Restaurarea
peste proiect produce downtime și se face numai printr-o aprobare separată.

## 2. Dump logic independent

Se recomandă client PostgreSQL 18 pentru serverul PostgreSQL 17. Exemplele de
mai jos nu conțin DSN sau parolă. Înlocuirea variabilelor se face local:

```sh
export LIVE_PGHOST='HOSTUL LIVE SAU SESSION POOLER DIN DASHBOARD'
export LIVE_PGPORT='5432'
export LIVE_PGUSER='USERUL EXACT DIN DIALOGUL CONNECT'
export LIVE_PGDATABASE='postgres'
export LIVE_PGPASSFILE='/cale/externa/restrictiva/live.pgpass'
export LIVE_BACKUP_DIR='/cale/externa/repository-ului/autorepair-live-pre-image-sync-YYYYMMDDTHHMMSSZ'
```

Directorul de backup trebuie să fie în afara repository-ului, criptat și cu
acces limitat. Înainte de dump se verifică identitatea în aceeași configurație:

```sh
env -i \
  HOME="$HOME" PATH="/opt/homebrew/opt/libpq/bin:/usr/bin:/bin" \
  PGPASSFILE="$LIVE_PGPASSFILE" PGSSLMODE=verify-full PGSSLROOTCERT=system \
  PGHOST="$LIVE_PGHOST" PGPORT="$LIVE_PGPORT" \
  PGUSER="$LIVE_PGUSER" PGDATABASE="$LIVE_PGDATABASE" \
  /opt/homebrew/opt/libpq/bin/psql -X -v ON_ERROR_STOP=1 --no-psqlrc <<'SQL'
SELECT
  current_database() = 'postgres'
  AND current_user = 'postgres'
  AND control.system_identifier::text = '7623125441096521075'
  AND control.system_identifier::text <> '7692131729119822239'
    AS live_identity_ok
FROM pg_catalog.pg_control_system() AS control;
SQL
```

Rezultatul trebuie să fie exact `t`. Apoi se creează arhiva custom într-un
snapshot consistent:

```sh
mkdir -m 700 "$LIVE_BACKUP_DIR"

env -i \
  HOME="$HOME" PATH="/opt/homebrew/opt/libpq/bin:/usr/bin:/bin" \
  PGPASSFILE="$LIVE_PGPASSFILE" PGSSLMODE=verify-full PGSSLROOTCERT=system \
  PGHOST="$LIVE_PGHOST" PGPORT="$LIVE_PGPORT" \
  PGUSER="$LIVE_PGUSER" PGDATABASE="$LIVE_PGDATABASE" \
  /opt/homebrew/opt/libpq/bin/pg_dump \
    --format=custom --compress=9 --no-password \
    --file="$LIVE_BACKUP_DIR/database.dump"
```

Dumpul implicit încearcă să includă toate schemele accesibile, inclusiv
`public`, `auth` și `storage`. Rolurile sunt obiecte globale și nu fac parte din
`pg_dump`; dacă este necesar un export de roluri, se folosește separat fluxul
oficial Supabase `supabase db dump --role-only`, fără a presupune că parolele
rolurilor custom sunt incluse.

## 3. Inventarul și manifestul

Înainte de instalare se rulează scriptul read-only, prin aceeași configurație
validată, iar singurul rând rezultat se salvează ca CSV:

```sh
env -i \
  HOME="$HOME" PATH="/opt/homebrew/opt/libpq/bin:/usr/bin:/bin" \
  PGPASSFILE="$LIVE_PGPASSFILE" PGSSLMODE=verify-full PGSSLROOTCERT=system \
  PGHOST="$LIVE_PGHOST" PGPORT="$LIVE_PGPORT" \
  PGUSER="$LIVE_PGUSER" PGDATABASE="$LIVE_PGDATABASE" \
  /opt/homebrew/opt/libpq/bin/psql -X -q -v ON_ERROR_STOP=1 --csv \
    --file=supabase/tests/inventory_repair_images_live_readonly.sql \
    --output="$LIVE_BACKUP_DIR/repair-images-inventory.csv"
```

Fișierul se deschide local și trebuie să conțină antetul plus exact un rând
`LIVE_INVENTORY_READY`; orice mesaj de eroare sau structură diferită blochează
continuarea. Apoi:

```sh
/opt/homebrew/opt/libpq/bin/pg_restore \
  --list "$LIVE_BACKUP_DIR/database.dump" \
  > "$LIVE_BACKUP_DIR/database.toc.txt"

shasum -a 256 \
  "$LIVE_BACKUP_DIR/database.dump" \
  "$LIVE_BACKUP_DIR/database.toc.txt" \
  "$LIVE_BACKUP_DIR/repair-images-inventory.csv" \
  > "$LIVE_BACKUP_DIR/SHA256SUMS"

shasum -a 256 -c "$LIVE_BACKUP_DIR/SHA256SUMS"
```

TOC-ul trebuie să conțină cel puțin obiecte și `TABLE DATA` pentru
`public.repair_requests`, `auth.users`, `storage.buckets` și `storage.objects`.
Absența lor blochează instalarea. Nu se publică TOC-ul: poate conține nume de
obiecte interne.

## 4. Verificarea restaurabilității

Existența și checksumul arhivei nu demonstrează restaurabilitatea. Înainte de
instalare se face una dintre următoarele verificări, fără a folosi LIVE sau
TEST ca destinație:

1. **Preferat:** restaurare într-un proiect Supabase nou, temporar, cu versiune
   PostgreSQL compatibilă și fără date business preexistente; sau
2. restaurare într-un stack Supabase local cu versiunea PostgreSQL potrivită.

Se păstrează logul complet al restaurării și se verifică:

- `pg_restore` se termină fără erori neacceptate;
- există `public.repair_requests`, `auth.users`, `storage.buckets` și
  `storage.objects`;
- numărul rândurilor `repair_requests` și agregatele inventarului imaginilor
  coincid cu CSV-ul baseline;
- funcțiile, trigger-ele, politicile și ACL-urile critice apar în TOC și în
  baza restaurată;
- dumpul nu este restaurat niciodată peste LIVE sau TEST.

Erorile privind obiecte managed Supabase se analizează individual; nu se ignoră
în bloc. Dacă restaurarea de probă nu este posibilă înaintea ferestrei, backupul
logic rămâne **neverificat**, iar instalarea este blocată.

## 5. Limita Storage

Backupul PostgreSQL păstrează metadata Storage, nu bytes-ii fotografiilor.
Inventarul permite comparații ulterioare, dar nu poate recrea un fișier șters.
În această etapă workerul și cronul LIVE rămân inactive, iar instalarea SQL nu
apelează Storage DELETE. Un backup fizic al obiectelor ar necesita un proces
Storage/S3 separat și o aprobare separată.

## Checklist înainte de cele patru migrări

- preflightul LIVE: 20/20 fără `FAIL`, rezultat arhivat;
- inventarul agregat salvat și hashuit;
- restore point Dashboard/PITR identificat înainte de fereastră;
- dump logic creat, TOC verificat, checksum verificat;
- restaurare de probă finalizată și comparată;
- workerul LIVE rămâne dezactivat și cronul nu poate șterge obiecte;
- uploadurile/editările sunt oprite sau există o fereastră coordonată;
- fișierele `20261003100000`–`20261003130000` au checksumurile aprobate;
- `10000`–`12000` se execută controlat într-o singură tranzacție, cu
  `ON_ERROR_STOP`; `13000` se execută apoi în tranzacția sa proprie;
- verificatorul post-install este pregătit înainte de primul DDL;
- există aprobare explicită separată pentru instalare.
