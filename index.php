<?php
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; font-src 'self' blob: data:; img-src 'self' blob: data:; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
?>
<!doctype html>
<html lang="ar" dir="rtl">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VITA | أرشيف جهات الاتصال</title>
<link rel="icon" href="assets/vita-mark.png">
<link rel="stylesheet" href="app.css?v=2">
<header><div class="branding"><img src="assets/vita-logo.png" alt="VITA"><strong>أرشيف جهات الاتصال</strong></div><button id="logout" hidden>تسجيل الخروج</button></header>
<main>
<p id="notice" role="status" hidden></p>
<form id="login" class="panel login" hidden>
<img class="login-mark" src="assets/vita-mark.png" alt="">
<h1>تسجيل الدخول</h1>
<label>اسم المستخدم<input name="username" autocomplete="username" required></label>
<label>كلمة المرور<input name="password" type="password" autocomplete="current-password" required></label>
<button class="primary">دخول</button>
</form>
<div id="archive" hidden>
<section class="panel">
<div class="heading"><h1>جهات الاتصال</h1><div class="actions"><button id="export">تصدير Excel</button><button id="add">إضافة سجل</button><button id="show-import" class="primary">استيراد ملفات</button></div></div>
<div class="fields"><label>بحث<input id="search" type="search" placeholder="الاسم أو رقم الهاتف"></label><label>الدولة<select id="country-filter"></select></label><label>التصنيف<select id="category-filter"></select></label><label>التاغ<select id="tag-filter"></select></label></div>
<p id="count"></p>
<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>الجنسية</th><th>الهوية الإماراتية</th><th>رقم الهاتف</th><th>البريد الإلكتروني</th><th>تاريخ الميلاد</th><th>الجنس</th><th>دولة الرقم</th><th>التصنيفات</th><th>التاغات</th><th></th></tr></thead><tbody id="contacts"></tbody></table></div>
<nav class="actions"><button id="prev">السابق</button><span id="page"></span><button id="next">التالي</button></nav>
</section>
<section class="panel" id="import-panel" hidden>
<h2>استيراد ملفات</h2>
<form id="import-form">
<div class="fields"><label>الملفات<input name="files" type="file" accept=".xlsx,.xls,.csv,.tsv,.docx,.pdf,.png,.jpeg,.jpg,.webp,.txt" multiple required></label>
<label>تصنيف الدفعة<input name="category" maxlength="120" required></label><label>الدولة الافتراضية للأرقام المحلية<select id="region" name="region"></select></label></div>
<button class="primary">قراءة الملفات</button>
</form>
<form id="mapping-form" hidden>
<h3>مطابقة أعمدة الملفات</h3>
<div id="mapping-sheets"></div>
<button class="primary">مطابقة الأعمدة ومعالجة السجلات</button>
</form>
<div id="review" hidden>
<h3>مراجعة قبل الحفظ</h3><p id="review-count"></p>
<div class="actions"><select id="review-filter" aria-label="حالة السجل"><option value="">كل السجلات</option><option value="valid">صالحة</option><option value="duplicate">مكررة</option><option value="missing">الدولة غير محددة</option><option value="invalid">غير صالحة</option><option value="details">بيانات تحتاج تصحيح</option></select><button id="remove-invalid">استبعاد الأرقام غير الصالحة</button><button id="save" class="primary">حفظ الأرقام الصالحة</button></div>
<div class="table-wrap"><table><thead><tr><th>المصدر</th><th>الاسم</th><th>الرقم</th><th>الجنسية</th><th>الهوية الإماراتية</th><th>البريد الإلكتروني</th><th>تاريخ الميلاد</th><th>الجنس</th><th>الدولة للأرقام المحلية</th><th>الحالة</th><th></th></tr></thead><tbody id="review-rows"></tbody></table></div>
<nav class="actions"><button id="review-prev">السابق</button><span id="review-page"></span><button id="review-next">التالي</button></nav>
</div>
</section>
</div>
</main>
<dialog id="editor">
<form id="edit-form">
<h2 id="editor-title"></h2>
<label>الاسم<input name="name" maxlength="200"></label>
<label>رقم الهاتف<input name="phone" dir="ltr" required></label>
<label>الدولة للأرقام المحلية<select name="country" id="editor-country"></select></label>
<div class="fields"><label>الجنسية<input name="nationality" maxlength="120"></label><label>الهوية الإماراتية<input name="emid" maxlength="32" dir="ltr"></label><label>البريد الإلكتروني<input name="email" type="email" maxlength="254" dir="ltr"></label><label>تاريخ الميلاد<input name="dob" type="date" min="1000-01-01" max="9999-12-31"></label><label>الجنس<input name="gender" maxlength="60"></label></div>
<label>التصنيفات<textarea name="categories" rows="2" placeholder="كل تصنيف بسطر"></textarea></label>
<label>التاغات<textarea name="tags" rows="2" placeholder="كل تاغ بسطر"></textarea></label>
<p id="edit-error" role="status"></p>
<div class="actions"><button class="primary">حفظ</button><button id="close-editor" type="button">إلغاء</button><button id="delete" type="button">حذف السجل</button></div>
</form>
</dialog>
<dialog id="source-dialog"><form method="dialog"><button>إغلاق</button></form><p id="source-label"></p><img id="source-image" alt="صورة المصدر"><pre id="source-text"></pre></dialog>
<script defer src="assets/libphonenumber-max.js"></script>
<script defer src="assets/xlsx.full.min.js"></script>
<script defer src="assets/jszip.min.js"></script>
<script defer src="assets/tesseract.min.js"></script>
<script type="module" src="app.mjs?v=2"></script>
</html>
