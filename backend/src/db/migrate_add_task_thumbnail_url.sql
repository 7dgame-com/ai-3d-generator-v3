ALTER TABLE tasks
ADD COLUMN thumbnail_url TEXT NULL COMMENT '缩略图 URL' AFTER output_url;
