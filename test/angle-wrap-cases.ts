// An address that is already in a loaded note, wrapped by typing `<` before it
// and `>` after it. `first` types into another block before the wrapping.
export interface WrapCase {
  name: string
  source: string
  address: string
  expected: string
  first?: { after: string; typed: string }
}

export const wrapCases: WrapCase[] = [
  {
    name: 'a URL beside duplicate casefolded reference definitions',
    source:
      'see https://x.com now [R]\n\n[r]: https://first.example\n[R]: https://second.example\n',
    address: 'https://x.com',
    expected:
      'see <https://x.com> now [R]\n\n[r]: https://first.example\n[R]: https://second.example\n',
  },
  {
    name: 'a URL beside a reference link',
    source: 'see https://x.com now [r]\n\n[r]: https://r.example\n',
    address: 'https://x.com',
    expected: 'see <https://x.com> now [r]\n\n[r]: https://r.example\n',
  },
  {
    name: 'an emphasised URL',
    source: 'see *https://x.com* now\n',
    address: 'https://x.com',
    expected: 'see *<https://x.com>* now\n',
  },
  {
    name: 'a URL with text after it',
    source: 'see https://x.com now\n',
    address: 'https://x.com',
    expected: 'see <https://x.com> now\n',
  },
  {
    name: 'a URL with no text after it',
    source: 'see https://x.com\n',
    address: 'https://x.com',
    expected: 'see <https://x.com>\n',
  },
  {
    name: 'a URL alone',
    source: 'https://x.com\n',
    address: 'https://x.com',
    expected: '<https://x.com>\n',
  },
  {
    name: 'a URL with a path and query',
    source: 'see https://x.com/a?q=1&b=2 now\n',
    address: 'https://x.com/a?q=1&b=2',
    expected: 'see <https://x.com/a?q=1&b=2> now\n',
  },
  {
    name: 'an email address with text after it',
    source: 'mail a@b.co now\n',
    address: 'a@b.co',
    expected: 'mail <a@b.co> now\n',
  },
  {
    name: 'an email address with no text after it',
    source: 'mail a@b.co\n',
    address: 'a@b.co',
    expected: 'mail <a@b.co>\n',
  },
  {
    name: 'a second address in the same paragraph',
    source: 'a https://a.com b https://x.com c\n',
    address: 'https://x.com',
    expected: 'a https://a.com b <https://x.com> c\n',
  },
  {
    name: 'an address beside a character reference',
    source: 'Tea &amp; see https://x.com now\n',
    address: 'https://x.com',
    expected: 'Tea &amp; see <https://x.com> now\n',
  },
  {
    // A `www.` address has no URI scheme, so CommonMark does not read it as an
    // angle autolink and the brackets stay text. The edit is still accepted.
    name: 'a www address',
    source: 'see www.x.com now\n',
    address: 'www.x.com',
    expected: 'see <[www.x.com](http://www.x.com)> now\n',
  },
  {
    name: 'a URL in a heading',
    source: '# see https://x.com now\n',
    address: 'https://x.com',
    expected: '# see <https://x.com> now\n',
  },
  {
    name: 'a URL in a list',
    source: '- see https://x.com now\n- other\n',
    address: 'https://x.com',
    expected: '- see <https://x.com> now\n- other\n',
  },
  {
    name: 'an email address in a list',
    source: '+ mail a@b.co now\n',
    address: 'a@b.co',
    expected: '+ mail <a@b.co> now\n',
  },
  {
    name: 'a URL in a quote',
    source: '> see https://x.com now\n',
    address: 'https://x.com',
    expected: '> see <https://x.com> now\n',
  },
  {
    name: 'a URL in a table cell',
    source: '| Link |\n| --- |\n| https://x.com |\n',
    address: 'https://x.com',
    expected: '| Link |\n| --- |\n| <https://x.com> |\n',
  },
  {
    name: 'a URL in a table cell with text beside it',
    source: '| Link | B |\n| --- | --- |\n| see https://x.com now | 1 |\n',
    address: 'https://x.com',
    expected: '| Link | B |\n| --- | --- |\n| see <https://x.com> now | 1 |\n',
  },
  {
    name: 'a URL in a CRLF note',
    source: 'Untouched &copy;\r\n\r\nsee https://x.com now\r\n\r\n+ other\r\n',
    address: 'https://x.com',
    expected:
      'Untouched &copy;\r\n\r\nsee <https://x.com> now\r\n\r\n+ other\r\n',
  },
  {
    name: 'an email address in a CRLF note',
    source: 'Untouched &copy;\r\n\r\nmail a@b.co now\r\n\r\n+ other\r\n',
    address: 'a@b.co',
    expected: 'Untouched &copy;\r\n\r\nmail <a@b.co> now\r\n\r\n+ other\r\n',
  },
  {
    name: 'a URL after another block was edited',
    source: 'Intro &copy;\n\nsee https://x.com now\n\n+ other\n',
    address: 'https://x.com',
    first: { after: 'Intro ©', typed: '!' },
    expected: 'Intro &copy;!\n\nsee <https://x.com> now\n\n+ other\n',
  },
  {
    name: 'an email address after another block was edited',
    source: 'Intro &copy;\n\nmail a@b.co now\n\n+ other\n',
    address: 'a@b.co',
    first: { after: 'Intro ©', typed: '!' },
    expected: 'Intro &copy;!\n\nmail <a@b.co> now\n\n+ other\n',
  },
  {
    name: 'a URL after a list item was edited',
    source: '- one\n- two\n\nsee https://x.com now\n',
    address: 'https://x.com',
    first: { after: 'one', typed: '!' },
    expected: '- one!\n- two\n\nsee <https://x.com> now\n',
  },
]
