# Seeds

`ats_directory_2026-08.csv` is the LastRound AI "ATS company directory" (August 2026): 9,935 companies with the applicant tracking system they use and their public board slug. Source: https://datahub.io/lastroundai-hiring-data/lastroundai-hiring-data/ats-directory, licence CC BY 4.0.

`jobtracker discover companies scan seeds/ats_directory_2026-08.csv` checks every board in it that isn't on the watchlist yet and adds the ones with an engineering role in Latin America or worldwide (plan §21). It takes about 20 minutes and stores no postings.

The starting watchlist, made from a scan of this file on 2026-11-14, ships inside the package: `src/jobtracker/adapters/seeds/ats_watchlist.csv`.
