import { defineConfig } from 'wmr';
import yaml from 'yaml';
import { promises as fs } from 'fs';
import path from 'path';

function markdownMiddleware(opts) {
	return async (req, res, next) => {
		if (!req.url.endsWith('.md')) return next();

		// Find YAML FrontMatter preceeding a markdown document
		const FRONT_MATTER_REG = /^\s*---\n\s*([\s\S]*?)\s*\n---\n/i;

		// Find a leading title in a markdown document
		const TITLE_REG = /^\s*#\s+(.+)\n+/;

		// FIXME:
		const filePath = path.join(opts.cwd, req.url);
		if (!filePath.startsWith(path.join(opts.cwd, 'content'))) {
			const err = new Error('Not found');
			err.code = 404;
			return next(err);
		}

		let content;
		try {
			content = await fs.readFile(filePath, 'utf-8');
		} catch (_) {
			const err = new Error('Not found');
			err.code = 404;
			return next(err);
		}

		const matches = content.match(FRONT_MATTER_REG);
		if (matches) {
			const meta =
				yaml.parse('---\n' + matches[1].replace(/^/gm, '  ') + '\n') || {};
			content = content.replace(FRONT_MATTER_REG, '');
			if (!meta.title) {
				let [, title] = content.match(TITLE_REG) || [];
				if (title) {
					content = content.replace(TITLE_REG, '');
					meta.title = title;
				}
			}

			content = '---\n' + JSON.stringify(meta) + '\n---\n' + content;
		}

		res.statusCode = 200;
		res.end(content);
	};
}

function markdownPlugin() {
	return {
		name: 'markdown-plugin',
		config(opts) {
			return {
				middleware: [markdownMiddleware(opts)]
			};
		}
	};
}

async function readRedirects(file) {
	const content = await fs.readFile(file, 'utf-8');

	return content.split('\n').reduce(
		(acc, line) => {
			if (line) {
				const [from, to] = line.split(' ');
				if (from !== to) {
					if (from.endsWith('*')) {
						acc.partial[from.slice(0, -1)] = to.slice(0, -1);
					} else {
						acc.exact[from] = to;
					}
				}
			}

			return acc;
		},
		{ exact: {}, partial: {} }
	);
}

/** @returns {import('wmr').Plugin} */
function netlifyPlugin({ redirectFile } = {}) {
	let redirects = { exact: {}, partial: {} };

	function redirect(req, res, to) {
		console.log(`Redirecting ${req.url} -> ${to}`, redirects);
		res.writeHead(302, { Location: to });
		res.end();
	}

	return {
		name: 'netlify',
		config() {
			return {
				middleware: [
					(req, res, next) => {
						let to = redirects.exact[req.url];
						if (to !== undefined) {
							redirect(req, res, to);
							return;
						}

						to = Object.keys(redirects.partial).find(from =>
							req.url.startsWith(from)
						);

						if (to !== undefined) {
							to = path.posix.join(to, req.url.slice(to.length));
							redirect(req, res, to);
							return;
						}

						next();
					}
				]
			};
		},
		async buildStart() {
			if (redirectFile) {
				redirects = await readRedirects(redirectFile);
				this.addWatchFile(redirectFile);
			}
		},
		async watchChange(id, ev) {
			if (id === redirectFile) {
				try {
					redirects = await readRedirects(redirectFile);
				} catch (err) {
					this.error(err);
				}
			}
		}
	};
}

export default defineConfig(opts => ({
	plugins: [
		markdownPlugin(),
		netlifyPlugin({
			redirectFile: path.join(opts.cwd, 'src', '_redirects')
		})
	],
	alias: {
		react: 'preact/compat',
		'react-dom': 'preact/compat'
	}
}));