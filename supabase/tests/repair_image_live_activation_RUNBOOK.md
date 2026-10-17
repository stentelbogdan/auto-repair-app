# Activare LIVE — sincronizare și cleanup imagini

Acest document pregătește activarea. Nu autorizează conectarea la LIVE,
instalarea SQL, configurarea Vercel, deploy-ul sau ștergerea din Storage.

## Gate-uri obligatorii

- LIVE: `ouoiykudvcoqbkybkqvs`, PostgreSQL
  `system_identifier=7623125441096521075`.
- TEST interzis: `bstjobvvxxfqqwyjoimx`, PostgreSQL
  `system_identifier=7692131729119822239`.
- Workerul rămâne inactiv până când sunt configurate explicit, numai în mediul
  Production din Vercel, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `REPAIR_IMAGE_CLEANUP_PROJECT_REF` și `CRON_SECRET`.
- `REPAIR_IMAGE_CLEANUP_PROJECT_REF` trebuie să fie exact
  `ouoiykudvcoqbkybkqvs`. Absența sau altă valoare blochează workerul.
- `SUPABASE_URL` trebuie să fie exact
  `https://ouoiykudvcoqbkybkqvs.supabase.co`. Workerul nu folosește
  `NEXT_PUBLIC_SUPABASE_URL`.
- Cronul rămâne Disabled până după verificarea instalării și deploy-ului.

## Ordinea instalării

1. Rulează și arhivează rezultatul
   `preflight_repair_image_sync_cleanup_live_readonly.sql`. Acceptă numai 20 de
   rânduri fără `FAIL`, cu identitatea LIVE exactă.
2. Confirmă restore point/PITR, dumpul verificat și inventarul Storage conform
   `repair_image_live_backup_preinstall.md`. Backupul PostgreSQL nu conține
   bytes-ii obiectelor Storage.
3. Stabilește o fereastră de mentenanță care oprește temporar uploadurile și
   editările imaginilor. DDL concurent nu este acoperit de lockurile pe tabele.
4. Verifică SHA-256 pentru cele patru migrații aprobate. Execută
   `20261003100000`, `20261003110000` și `20261003120000` controlat într-o
   singură conexiune și tranzacție, cu oprire la prima eroare. Execută apoi
   `20261003130000` în tranzacția proprie deja inclusă în fișier.
5. Nu continua dacă backfillul raportează obiect Storage lipsă, conflict de
   owner sau referință nevalidă. Eroarea din `130000` produce rollback integral
   pentru acea migrare.
6. Verifică după instalare funcțiile, ownerii, `SECURITY DEFINER`,
   `search_path`, ACL-urile, cele trei triggere de sincronizare, politica de
   upload rezervat, numărul referințelor și absența obiectelor eligibile pentru
   cleanup neașteptate. Workerul și cronul rămân inactive.
7. Configurează variabilele server-side Production fără a le copia în
   variabile `NEXT_PUBLIC_*`. Confirmă independent că URL-ul și cheia aparțin
   LIVE. Păstrează cronul Disabled.
8. Fă deploy coordonat al frontendului reserve → upload → confirm → save și al
   endpointului intern. Verifică upload, editare și închidere cu workerul încă
   inactiv.
9. Rulează o singură invocare controlată a endpointului numai după inventarul
   read-only al cozii. Activează cronul zilnic (`0 3 * * *`) numai după
   verificarea rezultatului. Frecvența și compatibilitatea planului Vercel se
   reconfirmă înainte de deploy.

## Revenire și recuperare

- Înainte de `COMMIT`, orice eroare oprește instalarea și tranzacția se
  anulează. Nu se continuă cu următoarea migrare.
- După instalarea SQL, dezactivează cronul și elimină
  `REPAIR_IMAGE_CLEANUP_PROJECT_REF` dacă workerul trebuie oprit imediat.
  Această măsură este reversibilă și nu modifică registry-ul.
- Nu se improvizează un teardown SQL după backfill. Se păstrează registry-ul și
  se investighează cu workerul oprit. Revenirea bazei folosește numai planul de
  restore aprobat separat.
- Ștergerea fizică Storage este permanentă și nu este reparată de un rollback
  PostgreSQL. Înaintea primei invocări se verifică exact coada eligibilă; orice
  candidat neașteptat blochează activarea.
- Cererile cu status `closed` își păstrează referințele și imaginile. Numai
  eliminarea imaginii din JSONB sau un DELETE real al cererii poate produce
  `tombstoned`, după dispariția ultimei referințe.

## Criterii de acceptare

- preflight LIVE fără `FAIL` și fără drift față de baseline;
- cele patru migrații instalate în ordinea `100000` → `130000`;
- backfill complet pentru imaginile legacy și moderne, fără obiecte lipsă sau
  conflicte de owner;
- ACL-urile cleanup acordă `EXECUTE` numai rolului `service_role` (și ownerului
  implicit), iar schema privată nu este expusă rolurilor API;
- verificările postinstalare trec înainte de configurarea workerului;
- uploadul și editarea funcționează după deploy cu cronul inactiv;
- prima coadă cleanup este inventariată și aprobată înainte de orice DELETE
  Storage;
- cronul zilnic este activat numai printr-o aprobare separată.
