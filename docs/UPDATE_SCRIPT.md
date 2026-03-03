# GitHub File Synchronization Script

## Overview

The `update.php` script copies files from this GitHub repository to specified folders on a hosting server. It's designed to be run directly on the server to update deployed files.

## Features

- **Wildcard support**: Use `*` to copy all files from a directory
- **Incremental updates**: Only copies files that are newer than local versions
- **Flexible configuration**: Settings stored in a separate `.conf` file
- **Secure**: Only allows `.conf` files from the same directory
- **Visual feedback**: HTML output showing sync results

## Usage

### Basic Usage

Upload `update.php` and a configuration file (e.g., `update.conf`) to your server, then access:

```
https://your-server.com/update.php?config=update.conf
```

### Configuration File Format

```conf
# Repository settings
repository: https://github.com/ideav/crm/
branch: main

# File mappings (source : target)
css/* : /var/www/site/css/
js/* : /var/www/site/js/
templates/main.html : /var/www/site/templates/
```

### Configuration Options

| Option | Description | Example |
|--------|-------------|---------|
| `repository` | GitHub repository URL | `https://github.com/owner/repo/` |
| `branch` | Branch to sync from | `main` |
| `source : target` | File mapping (source path : target directory) | `css/* : /var/www/css/` |

### Wildcard Patterns

- `css/*` - Copy all files from `css` folder
- `templates/my/*` - Copy all files from `templates/my` folder

Note: Wildcards only work for files, not subdirectories.

## Security Considerations

1. **Restrict access**: Protect `update.php` with HTTP authentication or IP restrictions
2. **Config files**: Configuration files should have `.conf` extension and be in the same directory
3. **File permissions**: Ensure the script has write permissions to target directories
4. **Rate limits**: GitHub API has rate limits; excessive syncs may be temporarily blocked

## Example: Setting up for ideav.ru

1. Upload files to server:
   - `update.php`
   - `update.conf`

2. Configure web server (Apache/Nginx) to protect the directory with authentication

3. Run sync by accessing:
   ```
   https://ideav.ru/admin/update.php?config=update.conf
   ```

## Output

The script displays an HTML page with:
- **Summary**: Count of copied, skipped, and failed files
- **Copied files**: Green - successfully updated files
- **Skipped files**: Blue - files that are already up to date
- **Errors**: Red - files that failed to sync

## Troubleshooting

### "Could not list directory" error
- Check if the source path exists in the repository
- Verify the branch name is correct

### "Failed to download" error
- Check network connectivity
- Verify GitHub repository is accessible
- Check for GitHub API rate limiting

### "Failed to write" error
- Verify target directory exists and is writable
- Check PHP has write permissions

### Files not updating
- GitHub API caches responses; wait a few minutes after commits
- Check that remote file modification date is newer than local

## API Rate Limits

The script uses the GitHub API which has rate limits:
- **Unauthenticated**: 60 requests per hour
- **Authenticated**: 5,000 requests per hour

For larger deployments, consider adding GitHub token authentication.
