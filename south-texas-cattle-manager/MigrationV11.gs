function migration_runV11(options) {
  options = options || {};
  return cattle_withDocumentLock_('MIGRATION_V11', function() {
    var beforeVersion = settings_get('Schema_Version', '');
    var hadUserRecords = setup_hasUserRecords_();
    var backupId = '';
    if (beforeVersion && beforeVersion !== CATTLEOS.VERSION && hadUserRecords) {
      backupId = setup_createBackupCopy_();
      migration_logAction_('Created backup before Version 1.1 migration.', { backupId: backupId });
    }
    var preservedCounty = settings_get('County', '');
    CATTLEOS.SYSTEM_SHEETS.forEach(function(sheetName) {
      var existed = !!cattle_getSheet_(sheetName);
      cattle_ensureHeaders_(sheetName);
      migration_logAction_((existed ? 'Verified sheet ' : 'Created sheet ') + sheetName, {});
    });
    settings_ensureDefaults();
    if (preservedCounty) {
      settings_set('County', preservedCounty);
      migration_logAction_('Preserved existing County setting.', { county: preservedCounty });
    }
    settings_set('Ranch_ZIP', settings_get('Ranch_ZIP', ''));
    settings_set('Schema_Version', CATTLEOS.VERSION, { editable: false });
    nws_buildWatchSheet();
    nws_buildMainDashboard();
    setup_populateHelpSheet_();
    setup_protectSystemSheets_();
    setup_orderSheets_();
    if (settings_getBool('NWS_Auto_Refresh', true)) nws_installRefreshTrigger();
    migration_logAction_('Updated schema version to 1.1.', { beforeVersion: beforeVersion, afterVersion: CATTLEOS.VERSION });
    audit_log('INFO', 'MIGRATION_V11', 'Version 1.1 migration completed.', {
      beforeVersion: beforeVersion,
      backupId: backupId,
      hadUserRecords: hadUserRecords
    });
    if (options.showOnboarding !== false) setup_showOnboardingDialog_();
    return true;
  });
}

function migration_logAction_(message, details) {
  audit_log('INFO', 'MIGRATION_V11_ACTION', message, details || {});
}
