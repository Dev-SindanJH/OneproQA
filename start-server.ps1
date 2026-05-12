# OneproQA 로컬 서버 (포트 8080)
# 실행: 이 파일을 우클릭 → "PowerShell로 실행"

$port = 8080
$root = $PSScriptRoot

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "  OneproQA 로컬 서버 시작됨" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "  주소: http://localhost:$port" -ForegroundColor Yellow
Write-Host "  종료: Ctrl+C" -ForegroundColor Gray
Write-Host ""

# 브라우저 자동 열기
Start-Process "http://localhost:$port"

$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.webp' = 'image/webp'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
}

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response

        $urlPath = $req.Url.LocalPath -replace '/', [System.IO.Path]::DirectorySeparatorChar
        if ($urlPath -eq '\') { $urlPath = '\index.html' }
        $filePath = Join-Path $root $urlPath.TrimStart('\')

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $res.ContentType = $mime
            $res.ContentLength64 = $bytes.Length
            $res.StatusCode = 200
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
            $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $urlPath")
            $res.ContentLength64 = $body.Length
            $res.OutputStream.Write($body, 0, $body.Length)
        }
        $res.OutputStream.Close()
    } catch {
        # 서버 종료 시 예외 무시
        if ($listener.IsListening) { Write-Host "오류: $_" -ForegroundColor Red }
    }
}
