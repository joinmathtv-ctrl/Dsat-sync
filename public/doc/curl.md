\# cURL Snippets



\## Health

```bash

curl http://localhost:3000/healthz

curl -H "Authorization: Bearer devtoken" http://localhost:3000/api/health



Pull (since 없이 전체)

curl -H "Authorization: Bearer devtoken" \\

"http://localhost:3000/api/attempts?userId=user\_demo"



Pull (증분)

curl -H "Authorization: Bearer devtoken" \\

"http://localhost:3000/api/attempts?userId=user\_demo\&since=1719970000000"



Push (Bulk)

curl -X POST "http://localhost:3000/api/attempts/bulk" \\

&nbsp; -H "Authorization: Bearer devtoken" \\

&nbsp; -H "Content-Type: application/json" \\

&nbsp; -d @payload.json



