export type SvgSourceLoader = {
  load: (url: string) => Promise<string>
}

export class FetchSvgSourceLoader implements SvgSourceLoader {
  async load(rawUrl: string) {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      throw new Error('Enter a valid SVG URL.')
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Use an http or https URL for the SVG.')
    }

    let response: Response
    try {
      response = await fetch(url, { headers: { Accept: 'image/svg+xml' } })
    } catch {
      throw new Error('The SVG could not be loaded. Check the URL and its sharing settings.')
    }

    if (!response.ok) throw new Error(`The SVG URL returned ${response.status}.`)
    return response.text()
  }
}
