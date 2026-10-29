param(
 [Parameter(Mandatory=$true)][ValidatePattern('^https://')][string]$BaseUrl,
 [string]$Question='대한전선 2026년 상반기 연결 기준 영업이익률과 산식을 알려줘'
)
$ErrorActionPreference='Stop'
$base=$BaseUrl.TrimEnd('/')
$health=Invoke-RestMethod -Uri "$base/api/agent/health" -TimeoutSec 45
if($health.mode -ne 'user_dart_key_persistent'){throw '서버 업데이트를 먼저 적용하세요.'}
$token=Read-Host '보관한 dn1. 연결코드 전체를 입력하세요'
$result=Invoke-RestMethod -Method Post -Uri "$base/api/agent/query" -ContentType 'application/json; charset=utf-8' -Body (@{question=$Question;sessionToken=$token}|ConvertTo-Json) -TimeoutSec 45
$result|ConvertTo-Json -Depth 16
$token=$null
