-- Moving on to the next list after "mark all as read" is on unless the user switches it off. The setting is
-- a few days old and was off by default until now, so a stored "off" was hardly ever a choice: it is
-- switched on here. A new server gets it switched on when its settings are first stored.

UPDATE settings SET advance_after_mark_all = 1;
