if File.exist?('index.zip')
  File.delete('index.zip')
end

system(%q{zip -r index.zip . -x".env" -x".git/*" -x"dynamodb_local_latest/*" -x"node_modules/typescript/*"})

system("aws lambda update-function-code --function-name spotify-playlist-dev --zip-file fileb://index.zip")
