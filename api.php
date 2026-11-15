<?php
declare(strict_types=1);

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function reply(array $body, int $status = 200): never {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function inputText(mixed $value, int $limit): string {
    if (!is_string($value) || mb_strlen($value) > $limit) {
        throw new InvalidArgumentException('النص أطول من الحد المسموح أو صيغته غير صحيحة.');
    }
    return trim($value);
}

function saveLabels(PDO $db, int $id, array $row): void {
    $statement = $db->prepare('INSERT INTO labels (contact_id,kind,label) VALUES (?,?,?) ON DUPLICATE KEY UPDATE label=label');
    foreach (['category' => 'categories', 'tag' => 'tags'] as $kind => $key) {
        $values = $row[$key] ?? [];
        if (!is_array($values) || count($values) > 100) {
            throw new InvalidArgumentException('عدد التصنيفات أو التاغات غير صالح.');
        }
        foreach ($values as $value) {
            $label = inputText($value, 120);
            if ($label !== '') {
                $statement->execute([$id, $kind, $label]);
            }
        }
    }
}

function contactFields(array $row): array {
    $phone = inputText($row['phone'] ?? '', 16);
    $country = inputText($row['country'] ?? '', 2);
    $name = inputText($row['name'] ?? '', 200);
    if (!preg_match('/^\+[1-9][0-9]{1,14}$/D', $phone) ||
        ($country !== '' && !preg_match('/^[A-Z]{2}$/D', $country))) {
        throw new InvalidArgumentException('صيغة رقم الهاتف أو الدولة غير صالحة.');
    }
    return [$name, $phone, $country];
}

if (empty($_SERVER['HTTPS']) || $_SERVER['HTTPS'] === 'off') {
    reply(['error' => 'افتح البرنامج عبر HTTPS.'], 400);
}
// Keep database credentials and the login hash outside the Git deployment tree.
$configPath = getenv('VITA_CONTACTS_CONFIG');
if (!$configPath && preg_match('~^(.+?)/public_html(?:/|$)~D', __DIR__, $parts)) {
    $configPath = $parts[1] . '/vita-contacts.private.php';
}
if (!$configPath || !is_readable($configPath)) {
    reply(['error' => 'إعدادات VITA الخاصة غير متاحة. راجع خطوات تثبيت GitHub وHostinger.'], 503);
}

$config = require $configPath;
session_name('CONTACT_ARCHIVE');
session_start(['cookie_httponly' => true, 'cookie_secure' => true, 'cookie_samesite' => 'Strict', 'use_strict_mode' => true]);
if (isset($_SESSION['active']) && time() - $_SESSION['active'] > 3600) {
    $_SESSION = [];
}
$_SESSION['csrf'] ??= bin2hex(random_bytes(32));

try {
    $action = $_GET['action'] ?? 'status';
    if ($action === 'status' && $_SERVER['REQUEST_METHOD'] === 'GET') {
        reply(['loggedIn' => isset($_SESSION['active']), 'csrf' => $_SESSION['csrf']]);
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'POST' ||
        !hash_equals($_SESSION['csrf'], $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '')) {
        reply(['error' => 'حدّث الصفحة وحاول مرة أخرى.'], 403);
    }

    $raw = file_get_contents('php://input', false, null, 0, 8 * 1024 * 1024 + 1);
    if (strlen($raw) > 8 * 1024 * 1024) {
        reply(['error' => 'دفعة البيانات أكبر من الحد المسموح.'], 413);
    }
    $body = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($body)) {
        throw new InvalidArgumentException('صيغة الطلب غير صالحة.');
    }

    if ($action === 'login') {
        $username = inputText($body['username'] ?? '', 150);
        $password = $body['password'] ?? '';
        $authorized = is_string($password) && strlen($password) <= 72 &&
            !str_contains($password, "\0") && password_verify($password, $config['password_hash']);
        if (!hash_equals($config['username'], $username) || !$authorized) {
            usleep(750000);
            reply(['error' => 'اسم المستخدم أو كلمة المرور غير صحيحة.'], 401);
        }
        session_regenerate_id(true);
        $_SESSION['active'] = time();
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        reply(['loggedIn' => true, 'csrf' => $_SESSION['csrf']]);
    }
    if (!isset($_SESSION['active'])) {
        reply(['error' => 'انتهت الجلسة. سجّل الدخول مجدداً.'], 401);
    }
    if ($action === 'logout') {
        $_SESSION = [];
        session_destroy();
        reply(['ok' => true]);
    }
    $_SESSION['active'] = time();
    session_write_close();

    $db = new PDO(
        'mysql:host=' . $config['host'] . ';dbname=' . $config['database'] . ';charset=utf8mb4',
        $config['db_user'], $config['db_password'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
    if ($action === 'list') {
        $after = max(0, (int) ($body['after'] ?? 0));
        $stmt = $db->prepare('SELECT id,name,phone,country FROM contacts WHERE id > ? ORDER BY id LIMIT 1000');
        $stmt->execute([$after]);
        $rows = [];
        foreach ($stmt as $row) {
            $rows[$row['id']] = $row + ['categories' => [], 'tags' => []];
        }
        if ($rows) {
            $stmt = $db->prepare('SELECT contact_id,kind,label FROM labels WHERE contact_id IN (' . implode(',', array_fill(0, count($rows), '?')) . ') ORDER BY label');
            $stmt->execute(array_keys($rows));
            foreach ($stmt as $label) {
                $rows[$label['contact_id']][$label['kind'] === 'tag' ? 'tags' : 'categories'][] = $label['label'];
            }
        }
        reply(['rows' => array_values($rows)]);
    }

    $db->beginTransaction();
    if ($action === 'import') {
        $rows = $body['rows'] ?? [];
        if (!is_array($rows) || count($rows) > 500) {
            throw new InvalidArgumentException('الحد الأقصى 500 سجل لكل دفعة.');
        }
        $stmt = $db->prepare("INSERT INTO contacts (name,phone,country) VALUES (?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), name=IF(name='',VALUES(name),name)");
        foreach ($rows as $row) {
            $stmt->execute(contactFields($row));
            saveLabels($db, (int) $db->lastInsertId(), $row);
        }
    } elseif ($action === 'add') {
        $db->prepare('INSERT INTO contacts (name,phone,country) VALUES (?,?,?)')->execute(contactFields($body));
        saveLabels($db, (int) $db->lastInsertId(), $body);
    } elseif ($action === 'edit' || $action === 'delete') {
        $id = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($id === false) {
            throw new InvalidArgumentException('السجل غير صالح.');
        }
        $stmt = $db->prepare('SELECT id FROM contacts WHERE id=? FOR UPDATE');
        $stmt->execute([$id]);
        if (!$stmt->fetchColumn()) {
            reply(['error' => 'السجل غير موجود. حدّث القائمة.'], 404);
        }
        if ($action === 'delete') {
            $db->prepare('DELETE FROM contacts WHERE id=?')->execute([$id]);
        } else {
            $db->prepare('UPDATE contacts SET name=?,phone=?,country=? WHERE id=?')->execute([...contactFields($body), $id]);
            $db->prepare('DELETE FROM labels WHERE contact_id=?')->execute([$id]);
            saveLabels($db, $id, $body);
        }
    } else {
        reply(['error' => 'الطلب غير معروف.'], 404);
    }
    $db->commit();
    reply(['ok' => true]);
} catch (InvalidArgumentException | JsonException $e) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    reply(['error' => $e instanceof InvalidArgumentException ? $e->getMessage() : 'الطلب غير صالح.'], 422);
} catch (PDOException $e) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    if (($e->errorInfo[1] ?? 0) === 1062) {
        reply(['error' => 'رقم الهاتف موجود في سجل آخر.'], 409);
    }
    reply(['error' => 'تعذّر الوصول لقاعدة البيانات أو حفظ التعديلات.'], 500);
} catch (Throwable $e) {
    if (isset($db) && $db->inTransaction()) $db->rollBack();
    reply(['error' => 'حدث خطأ في معالجة الطلب.'], 500);
}
