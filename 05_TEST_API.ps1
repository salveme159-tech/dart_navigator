param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^https://')]
  [string]$BaseUrl,
  [string]$Question = '대한전선 2026년 상반기 연결 기준 영업이익률과 산식을 알려줘'
)

$ErrorActionPreference = 'Stop'
$base = $BaseUrl.TrimEnd('/')

Write-Host "[1/3] 웹/API 상태 확인: $base/api/health" -ForegroundColor Cyan
try {
  $health = Invoke-RestMethod -Method Get -Uri "$base/api/health" -TimeoutSec 30
  if ($health.status -ne 'ok') { throw "기본 health 응답이 정상 상태가 아닙니다." }
  Write-Host "기본 서버 상태: ok" -ForegroundColor Green
} catch {
  Write-Error "서버에 연결할 수 없습니다. 배포 URL과 서비스 상태를 확인하세요. $($_.Exception.Message)"
  exit 1
}

Write-Host "[2/3] ChatGPT Action 구성 상태 확인" -ForegroundColor Cyan
try {
  $agentHealth = Invoke-RestMethod -Method Get -Uri "$base/api/agent/health" -TimeoutSec 30
  if ($agentHealth.status -ne 'ready' -or -not $agentHealth.agentKeyConfigured -or -not $agentHealth.openDartKeyConfigured) {
    Write-Error "Agent API가 준비되지 않았습니다: $($agentHealth.message)"
    exit 2
  }
  Write-Host "Agent API 상태: ready (비밀값은 출력하지 않음)" -ForegroundColor Green
} catch {
  $detail = $_.ErrorDetails.Message
  if (-not $detail) { $detail = $_.Exception.Message }
  Write-Error "Agent API 설정 확인 실패: $detail"
  exit 2
}

Write-Host "[3/3] 실제 DART 질의 실행" -ForegroundColor Cyan
$secureKey = Read-Host 'AGENT_API_KEY를 입력하세요 (화면에 표시되지 않음)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $agentKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $headers = @{ Authorization = "Bearer $agentKey" }
  $body = @{ question = $Question } | ConvertTo-Json -Depth 8
  $result = Invoke-RestMethod -Method Post -Uri "$base/api/agent/query" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 90
  $result | ConvertTo-Json -Depth 12
  if ($result.found -eq $true) {
    Write-Host "질의 성공: 위 응답의 회사·기간·기준·산식·출처를 DART 원문과 대조하세요." -ForegroundColor Green
  } else {
    Write-Warning "API 호출은 완료됐지만 조회 결과는 found=false입니다. 반환 메시지와 공시/계정 매칭을 확인하세요."
  }
} catch {
  $detail = $_.ErrorDetails.Message
  if (-not $detail) { $detail = $_.Exception.Message }
  Write-Error "실제 질의 실패: $detail"
  exit 3
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  $agentKey = $null
}
