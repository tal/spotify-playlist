if File.exist?('index.zip')
  File.delete('index.zip')
end

system(%q{zip -r index.zip . -".env" -x".git"})

system("aws lambda update-function-code --function-name spotify-playlist-dev --zip-file fileb://index.zip")
