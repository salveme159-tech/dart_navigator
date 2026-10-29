# 본인의 PC에서 실행하세요. 결과값은 Render 환경변수에만 입력하고 공유하지 마세요.
$bytes=New-Object byte[] 32
$rng=[System.Security.Cryptography.RandomNumberGenerator]::Create()
try {$rng.GetBytes($bytes)} finally {$rng.Dispose()}
$value=([System.BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
Write-Output 'Render > Environment > AGENT_CONNECTION_SECRET 에 아래 값을 입력하세요.'
Write-Output $value
Write-Output '이 값은 계속 유지하세요. GitHub나 GPT에는 넣지 마세요.'
