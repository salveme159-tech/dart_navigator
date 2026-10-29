# 배포 후 확인

1. /api/agent/health에서 mode=user_dart_key_persistent, connectionExpires=false, status=ready 확인.
2. 본인 DART 키로 /agent-connect에서 dn1.로 시작하는 코드를 받아 비공개로 보관.
3. GPT 지침·스키마를 교체하고 Authentication=None으로 질문.
4. 서버 재시작 전후 보관한 같은 코드로 실제 DART 조회.
5. 1시간 후 같은 코드로 조회. 새 GPT 대화에서도 같은 코드를 붙여 넣고 조회.
6. 사용자마다 본인 키를 사용하며 코드 없이는 조회되지 않는지 확인.
7. 실제 공시와 숫자·기간·연결 기준·단위·산식 대조. CAPEX/FCF는 원천값 미확인 시 임의 생성하지 않음.
8. 기존 웹앱의 기업 조회와 공시 알람 동작 확인.

로컬 테스트는 실제 DART 통신이나 GPT 화면을 검증한 것이 아닙니다.
