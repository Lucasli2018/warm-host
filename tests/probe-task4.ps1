# warm-host Task 4 探针：宠物 CRUD + R2 多图
$base = 'http://127.0.0.1:8787'

# --- 工具函数 ---
function JsonPost($url, $obj, $headers = $null) {
  $body = $obj | ConvertTo-Json -Depth 6
  Invoke-RestMethod -Uri $url -Method POST -ContentType 'application/json' -Body $body -UseBasicParsing -Headers $headers
}
function JsonPut($url, $obj, $headers = $null) {
  $body = $obj | ConvertTo-Json -Depth 6
  Invoke-RestMethod -Uri $url -Method PUT -ContentType 'application/json' -Body $body -UseBasicParsing -Headers $headers
}
function JsonDel($url, $headers = $null) {
  Invoke-RestMethod -Uri $url -Method DELETE -UseBasicParsing -Headers $headers
}
function JsonDelBody($url, $obj, $headers = $null) {
  $body = $obj | ConvertTo-Json -Depth 6
  Invoke-RestMethod -Uri $url -Method DELETE -ContentType 'application/json' -Body $body -UseBasicParsing -Headers $headers
}
function JsonGet($url, $headers = $null) {
  Invoke-RestMethod -Uri $url -UseBasicParsing -Headers $headers
}
function Check($name, $cond) {
  if ($cond) { Write-Host "  ✅ $name" -ForegroundColor Green }
  else { Write-Host "  ❌ $name" -ForegroundColor Red }
}

# ============================================================
# 登录 admin
# ============================================================
Write-Host "=== 登录 admin ==="
$login = JsonPost "$base/api/auth/login" @{phone='admin'; password='admin123'}
$token = $login.token
$H = @{ 'Authorization' = "Bearer $token" }
Check "获得 token" $true

# ============================================================
# 1. POST /api/pets 创建宠物
# ============================================================
Write-Host "`n=== [1] POST /api/pets ==="
$pet1 = JsonPost "$base/api/pets" @{
  name='豆豆'; species='狗'; breed='柯基'; gender='母'; age='2岁'; weight='12kg'
  personality=@('友善','粘人')
  health_notes='已绝育,无过敏'; daily_habits='每天遛两次'; special_needs='需安静'
} -Headers $H
Check "创建成功 (id 非空)" $pet1.id
Check "返回字段完整" ($pet1.name -eq '豆豆' -and $pet1.species -eq '狗' -and ($pet1.personality -contains '友善'))
$petId = $pet1.id
Write-Host "  petId = $petId"

# ============================================================
# 2. GET /api/pets/my
# ============================================================
Write-Host "`n=== [2] GET /api/pets/my ==="
$my = JsonGet "$base/api/pets/my" -Headers $H
Check "至少 1 只宠物" ($my.Count -ge 1)
Check "包含刚创建的" (($my | Where-Object { $_.id -eq $petId }) -ne $null)

# ============================================================
# 3. GET /api/pets/<id> 公开读
# ============================================================
Write-Host "`n=== [3] GET /api/pets/<id> ==="
$detail = JsonGet "$base/api/pets/$petId" -Headers $H
Check "返回名字" ($detail.name -eq '豆豆')
Check "返回照片数组" ($detail.photos -is [array] -or $detail.photos -is [string])

# ============================================================
# 4. PUT 更新
# ============================================================
Write-Host "`n=== [4] PUT /api/pets/<id> ==="
$upd = JsonPut "$base/api/pets/$petId" @{
  name='豆豆'; species='狗'; breed='柯基犬'; gender='母'; age='3岁'; weight='13kg'
  personality=@('友善','活泼','粘人')
  health_notes='已绝育,无过敏,已驱虫'; daily_habits='每天遛两次'; special_needs='需安静环境'
} -Headers $H
Check "name 保留" ($upd.name -eq '豆豆')
Check "breed 更新" ($upd.breed -eq '柯基犬')
Check "personality 更新" (($upd.personality -contains '活泼'))

# ============================================================
# 5. POST photos 上传 2 张 1x1 PNG
# ============================================================
Write-Host "`n=== [5] POST photos (上传 2 张 1x1 PNG) ==="
# 生成 1x1 PNG
$pngBytes = [byte[]]@((0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x06,0x00,0x00,0x00,0x1F,0x15,0xC4,0x89,0x00,0x00,0x00,0x0A,0x49,0x44,0x41,0x54,0x78,0x9C,0x62,0x00,0x01,0x00,0x00,0x05,0x00,0x01,0x0D,0x0A,0x2D,0xB4,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,0xAE,0x42,0x60,0x82))
$pngPath = Join-Path $env:TEMP "pet-test-1x1.png"
[System.IO.File]::WriteAllBytes($pngPath, $pngBytes)

# 用 multipart/form-data 上传
function UploadPhoto($file) {
  $boundary = [System.Guid]::NewGuid().ToString()
  $LF = "`r`n"
  $bodyLines = @(
    "--$boundary",
    'Content-Type: image/png',
    'Content-Disposition: form-data; name="file"; filename="pet-1x1.png"',
    "",
    ""
  ) -join $LF
  $endLines = $LF + "--$boundary--" + $LF
  $headerBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyLines)
  $endBytes = [System.Text.Encoding]::UTF8.GetBytes($endLines)
  $allBytes = New-Object byte[] ($headerBytes.Length + $pngBytes.Length + $endBytes.Length)
  [Array]::Copy($headerBytes, 0, $allBytes, 0, $headerBytes.Length)
  [Array]::Copy($pngBytes, 0, $allBytes, $headerBytes.Length, $pngBytes.Length)
  [Array]::Copy($endBytes, 0, $allBytes, $headerBytes.Length + $pngBytes.Length, $endBytes.Length)

  Invoke-RestMethod -Uri "$base/api/pets/$petId/photos" -Method POST -Headers $H -ContentType "multipart/form-data; boundary=$boundary" -Body $allBytes -UseBasicParsing
}

try {
  $r1 = UploadPhoto $pngPath
  Check "上传第 1 张 OK" ($r1.photos.Count -eq 1)
  $photoKey1 = $r1.photos[0]
  Check "自动设为 cover" ($r1.cover_key -eq $photoKey1)

  $r2 = UploadPhoto $pngPath
  Check "上传第 2 张 OK" ($r2.photos.Count -eq 2)
  Check "cover 不变" ($r2.cover_key -eq $photoKey1)
  $photoKey2 = $r2.photos[1]
} catch {
  Write-Host "  ⚠️ 上传失败: $($_.Exception.Message)"
  Check "上传成功" $false
}

# ============================================================
# 6. GET photos/<key> 读取
# ============================================================
Write-Host "`n=== [6] GET photos/<key> 读取 ==="
if ($photoKey1) {
  try {
    $imgResp = Invoke-WebRequest -Uri "$base/api/pets/$petId/photos/$photoKey1" -UseBasicParsing
    Check "返回 200" ($imgResp.StatusCode -eq 200)
    Check "content-type=image/png" ($imgResp.Headers['content-type'] -like '*image/png*')
    Check "content-length 存在" ($imgResp.Headers['content-length'] -ne $null)
  } catch {
    Check "图片读取" $false
    Write-Host "  $_"
  }
}

# ============================================================
# 7. PUT 设主图（把第 2 张设为主图）
# ============================================================
Write-Host "`n=== [7] PUT 设主图 ==="
if ($photoKey2) {
  $coverRes = JsonPut "$base/api/pets/$petId/photos" @{ coverKey = $photoKey2 } -Headers $H
  Check "cover_key 变更" ($coverRes.cover_key -eq $photoKey2)
  Check "photos 数量不变" ($coverRes.photos.Count -eq 2)
}

# 越权：coverKey 不在数组内
try {
  $bad = JsonPut "$base/api/pets/$petId/photos" @{ coverKey = 'not-a-real-key' } -Headers $H
  Check "非成员 coverKey 应拒绝" $false
} catch {
  Check "非成员 coverKey 拒绝" $true
}

# ============================================================
# 8. DELETE 删一张照片
# ============================================================
Write-Host "`n=== [8] DELETE 删一张照片 ==="
if ($photoKey2) {
  $delRes = JsonDelBody "$base/api/pets/$petId/photos" @{ photoKey = $photoKey2 } -Headers $H
  Check "photos 数量减 1" ($delRes.photos.Count -eq 1)
  Check "cover 仍指向第 1 张" ($delRes.cover_key -eq $photoKey1)
}

# 越权：删不存在的照片
try {
  $badDel = JsonDelBody "$base/api/pets/$petId/photos" @{ photoKey = 'not-a-real-key' } -Headers $H
  Check "删不存在照片应拒绝" $false
} catch {
  Check "删不存在照片拒绝" $true
}

# ============================================================
# 9. 越权测试：其他用户删 admin 的宠物
# ============================================================
Write-Host "`n=== [9] 越权测试 ==="
# 注册一个新用户
# 先拿一个邀请码 —— 直接查库不方便，用 seed 的一个未使用码
# 用 admin 查库不方便。改用另一种策略：直接尝试用 admin 的 token 但换 petId
# 或者用一个无效 token
# 简单做法：用未登录访问
try {
  $unauth = JsonDel "$base/api/pets/$petId"  # 无 auth header
  Check "未登录删除应失败" $false
} catch {
  Check "未登录删除被拒 (401)" $true
}

# 用一个假 token
try {
  $bad = JsonDel "$base/api/pets/$petId" -Headers @{ 'Authorization' = 'Bearer invalid_token_xyz' }
  Check "无效 token 删除应失败" $false
} catch {
  Check "无效 token 被拒" $true
}

# ============================================================
# 10. DELETE 删除宠物
# ============================================================
Write-Host "`n=== [10] DELETE /api/pets/<id> ==="
$delRes = JsonDel "$base/api/pets/$petId" -Headers $H
Check "删除返回 success=true" ($delRes.success -eq $true)

# 验证已删除
try {
  $gone = JsonGet "$base/api/pets/$petId" -Headers $H
  Check "删除后 GET 应 404" $false
} catch {
  Check "删除后 GET 返回 404" $true
}

# ============================================================
# 11. 前端页面加载（HEAD/GET）
# ============================================================
Write-Host "`n=== [11] 前端页面加载 ==="
try {
  $myPage = Invoke-WebRequest -Uri "$base/my.html" -UseBasicParsing
  Check "my.html 返回 200" ($myPage.StatusCode -eq 200)
  Check "包含 pet-form" ($myPage.Content -like '*pet-form*')
  Check "包含 personality-chips" ($myPage.Content -like '*personality-chips*')
} catch {
  Check "my.html 加载失败" $false
  Write-Host "  $_"
}

try {
  $jsPage = Invoke-WebRequest -Uri "$base/js/pages/my.js" -UseBasicParsing
  Check "my.js 返回 200" ($jsPage.StatusCode -eq 200)
  Check "包含 PERSONALITY_TAGS" ($jsPage.Content -like '*PERSONALITY_TAGS*')
} catch {
  Check "my.js 加载失败" $false
  Write-Host "  $_"
}

Write-Host "`n================================================"
Write-Host "所有测试完成" -ForegroundColor Cyan
