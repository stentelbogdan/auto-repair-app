# Test controlat Storage E2E pentru cleanup-ul imaginilor

Runnerul `run_repair_image_cleanup_storage_e2e_test.ts` creează o imagine PNG
1×1 cu path unic în proiectul Supabase TEST și un utilizator plus o cerere
strict sintetice. Pregătește obiectul prin `discovered → uploaded`, iar
triggerul de sincronizare îl trece în `attached` la inserarea cererii. Runnerul
golește apoi `repair_requests.images` și cere dovada că eliminarea ultimei
referințe produce `attached → tombstoned`. Cererea și utilizatorul sintetice
sunt eliminate înaintea workerului. Workerul rulează o singură dată, după care
runnerul confirmă ștergerea Storage și starea finală `deleted`.

## Condiții obligatorii

- Cronul de cleanup trebuie să fie dezactivat pe durata testului.
- Niciun alt worker sau proces de reconciliere nu trebuie să ruleze în paralel.
- Cele șase rânduri `quarantined` trebuie să fie singurele rânduri istorice
  relevante, iar snapshotul lor trebuie să rămână stabil.
- `PGPASSFILE` trebuie să indice un fișier extern cu permisiuni `0600` și o
  intrare pentru conexiunea TEST aleasă. Parola nu este transmisă în argumentele
  proceselor.
- `SUPABASE_SERVICE_ROLE_KEY` trebuie exportată numai în shell-ul local care
  pornește runnerul. Nu se scrie în repository și nu se folosește în browser.
- Runnerul folosește endpointurile fixe `bstjobvvxxfqqwyjoimx`; URL-ul LIVE nu
  este configurabil și workerul îl respinge separat.

## Verificări fail-closed

Înainte de upload, runnerul verifică identitatea PostgreSQL TEST, absența
oricărui obiect eligibil pentru cleanup și snapshotul complet al celor șase
rânduri `quarantined`. Eligibilitatea include:

- orice `tombstoned`;
- `delete_claimed` cu lease expirat;
- `reserved` al cărui lease a expirat de cel puțin o oră și care nu are referințe;
- `uploaded` fără referințe, mai vechi de o oră.

Aceleași condiții sunt reverificate imediat înainte de worker. Atunci trebuie să
existe exact un singur candidat: obiectul sintetic al execuției, fără referințe,
cu metadata Storage încă prezentă. După worker, runnerul cere rezultatul exact
`{ claimed: 1, deleted: 1, failed: 0 }`, verifică prin cereri fără cache că
fișierul nu mai poate fi listat sau descărcat, că registry-ul este `deleted` și
că snapshotul `quarantined` nu s-a schimbat.

## Execuție manuală ulterioară

Runnerul cere alegerea explicită a uneia dintre cele două conexiuni PostgreSQL:

- `direct`: hostul fix `db.bstjobvvxxfqqwyjoimx.supabase.co`, port `5432`,
  database `postgres`, user `postgres`;
- `session_pooler`: hostul regional copiat din Dashboard, cu forma
  `aws-<număr>-<regiune>.pooler.supabase.com`, port `5432`, database `postgres`
  și user construit obligatoriu ca `postgres.bstjobvvxxfqqwyjoimx`.

În ambele moduri, mediul libpq este construit dintr-un allowlist și gate-ul
server-side cere `system_identifier=7692131729119822239` înainte de orice
modificare. Un hostname Pooler valid nu este considerat singur dovadă de
identitate. Portul `6543` pentru transaction pooling nu este acceptat deoarece
testul necesită semantică de sesiune previzibilă.

Pentru conexiunea directă:

```sh
export REPAIR_IMAGE_TEST_DB_MODE=direct
```

Pentru Session Pooler:

```sh
export REPAIR_IMAGE_TEST_DB_MODE=session_pooler
export REPAIR_IMAGE_TEST_POOLER_HOST='hostul regional din Dashboard'
```

După aprobarea explicită, din rădăcina repository-ului:

```sh
test -n "${PGPASSFILE:-}"
test -n "${SUPABASE_SERVICE_ROLE_KEY:-}"
node --experimental-strip-types \
  supabase/tests/run_repair_image_cleanup_storage_e2e_test.ts
```

Cele două variabile trebuie încărcate în prealabil prin mecanismul local de
secrete aprobat. Comenzile de mai sus verifică numai prezența lor și nu le
afișează sau transmite ca argumente de proces.

Nu activa cronul înainte sau în timpul acestei execuții. La eșec după pregătirea
registry-ului, runnerul nu forțează ștergerea sau rescrierea stării: obiectul
rămâne în mecanismul normal de retry și trebuie investigat înainte de o nouă
execuție. Dacă uploadul eșuează înainte de pregătirea registry-ului, runnerul
încearcă să elimine numai path-ul sintetic unic al execuției.
Rezultatul acestei ștergeri de compensare este verificat explicit. Dacă și ea
eșuează, runnerul raportează separat eroarea inițială și eroarea de cleanup,
redactând orice apariție accidentală a cheii service role.

## Limită de concurență

Verificarea imediat anterioară workerului reduce fereastra de cursă, dar nu poate
bloca procese externe care nu cooperează cu runnerul. De aceea exclusivitatea
operațională și cronul dezactivat sunt condiții de acceptare, nu recomandări.
