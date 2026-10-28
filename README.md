# issue-smp

SMT AOI 검사장비 SW 이슈관리대장(**합성 데이터**) 질의응답 공개 데모 화면입니다.

- 정적 페이지(HTML·CSS·JS)만 있습니다. 빌드 과정이 없습니다.
- 질문은 데모 API(`https://issue.intekplus.dev/demo/api/ask`)로 보냅니다. 검색·집계와 답변 생성은 그 서버가 맡습니다.
- 이 저장소에는 API 키, 토큰, 데이터가 없습니다. 이 저장소에 넣으면 안 됩니다(공개 저장소).

## Vercel 배포

1. Vercel → Add New → Project → 이 저장소 Import
2. Framework Preset: **Other**, Build Command: 비움, Output Directory: 비움(루트)
3. Deploy — 환경변수는 필요 없습니다
